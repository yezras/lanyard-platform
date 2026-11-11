#!/usr/bin/env bash
# Operator check: newest completed EBS snapshot age for a Company Brain project.
#
# Selects snapshots tagged Project=<name> (and optionally Backup=daily).
# Optionally publishes CloudWatch custom metric CompanyBrain/Backup NewestSnapshotAgeHours
# (dimension Project) for the Terraform alarm in modules/company-brain-ec2.
#
# Usage (from operator workstation with AWS credentials for the tenant account):
#   bash scripts/check-snapshot-age.sh --project acme-brain --region us-east-1
#   bash scripts/check-snapshot-age.sh --project acme-brain --publish-metric
#   bash scripts/check-snapshot-age.sh --project acme-brain --max-age-hours 36 --sns-topic-arn arn:aws:sns:...
#
# Exit codes:
#   0  newest snapshot within threshold
#   1  usage / CLI error
#   2  no completed snapshots found (or age over threshold)
#   3  AWS CLI / dependency failure
set -euo pipefail

PROJECT=""
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
MAX_AGE_HOURS=36
PUBLISH_METRIC=0
SNS_TOPIC_ARN=""
REQUIRE_BACKUP_TAG=1
JSON_OUT=0
OWNER_IDS="self"

usage() {
  sed -n '2,20p' "$0" | sed 's/^# \?//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --max-age-hours)
      MAX_AGE_HOURS="${2:-}"
      shift 2
      ;;
    --publish-metric)
      PUBLISH_METRIC=1
      shift
      ;;
    --sns-topic-arn)
      SNS_TOPIC_ARN="${2:-}"
      shift 2
      ;;
    --no-backup-tag)
      REQUIRE_BACKUP_TAG=0
      shift
      ;;
    --json)
      JSON_OUT=1
      shift
      ;;
    -h | --help)
      usage
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "$PROJECT" ]]; then
  echo "ERROR: --project is required" >&2
  usage
fi

if ! [[ "$MAX_AGE_HOURS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "ERROR: --max-age-hours must be a number" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found" >&2
  exit 3
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "ERROR: python3 not found (needed for age math)" >&2
  exit 3
fi

AWS=(aws)
if [[ -n "$REGION" ]]; then
  AWS+=(--region "$REGION")
fi

FILTERS=(Name=tag:Project,Values="$PROJECT" Name=status,Values=completed)
if [[ "$REQUIRE_BACKUP_TAG" -eq 1 ]]; then
  FILTERS+=(Name=tag:Backup,Values=daily)
fi

# shellcheck disable=SC2016
SNAPSHOT_JSON="$("${AWS[@]}" ec2 describe-snapshots \
  --owner-ids "$OWNER_IDS" \
  --filters "${FILTERS[@]}" \
  --query 'Snapshots[].{SnapshotId:SnapshotId,StartTime:StartTime,VolumeId:VolumeId,State:State}' \
  --output json 2>/dev/null)" || {
  echo "ERROR: describe-snapshots failed (check credentials/region)" >&2
  exit 3
}

EVAL="$(
  MAX_AGE_HOURS="$MAX_AGE_HOURS" PROJECT="$PROJECT" python3 -c '
import json, os, sys
from datetime import datetime, timezone

raw = sys.stdin.read()
try:
    snaps = json.loads(raw) if raw.strip() else []
except json.JSONDecodeError as e:
    print(json.dumps({"error": f"bad snapshot json: {e}"}))
    sys.exit(3)

max_age = float(os.environ["MAX_AGE_HOURS"])
project = os.environ["PROJECT"]
now = datetime.now(timezone.utc)

parsed = []
for s in snaps:
    st = s.get("StartTime")
    if not st:
        continue
    # AWS returns ISO8601 with Z
    t = datetime.fromisoformat(st.replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    age_h = (now - t).total_seconds() / 3600.0
    parsed.append({
        "snapshot_id": s.get("SnapshotId"),
        "volume_id": s.get("VolumeId"),
        "start_time": st,
        "age_hours": round(age_h, 3),
    })

parsed.sort(key=lambda x: x["age_hours"])
newest = parsed[0] if parsed else None
age = newest["age_hours"] if newest else None
status = "ok"
exit_code = 0
if newest is None:
    status = "missing"
    exit_code = 2
elif age is not None and age > max_age:
    status = "stale"
    exit_code = 2

out = {
    "project": project,
    "status": status,
    "max_age_hours": max_age,
    "snapshot_count": len(parsed),
    "newest": newest,
    "newest_age_hours": age,
    "metric_namespace": "CompanyBrain/Backup",
    "metric_name": "NewestSnapshotAgeHours",
}
print(json.dumps(out))
sys.exit(0)
' <<<"$SNAPSHOT_JSON"
)" || {
  echo "ERROR: failed to evaluate snapshot ages" >&2
  exit 3
}

STATUS="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<<"$EVAL")"
NEWEST_AGE="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["newest_age_hours"] if d["newest_age_hours"] is not None else "")' <<<"$EVAL")"
SNAP_ID="$(python3 -c 'import json,sys; d=json.load(sys.stdin); n=d.get("newest") or {}; print(n.get("snapshot_id") or "")' <<<"$EVAL")"
COUNT="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["snapshot_count"])' <<<"$EVAL")"

# Publish metric when requested. Missing snapshots → publish a large age so treat_missing_data
# and threshold both surface durability risk (use 2x max as synthetic).
METRIC_VALUE="$NEWEST_AGE"
if [[ -z "$METRIC_VALUE" ]]; then
  METRIC_VALUE="$(python3 -c "print(float('${MAX_AGE_HOURS}') * 2)")"
fi

if [[ "$PUBLISH_METRIC" -eq 1 ]]; then
  "${AWS[@]}" cloudwatch put-metric-data \
    --namespace "CompanyBrain/Backup" \
    --metric-data "MetricName=NewestSnapshotAgeHours,Dimensions=[{Name=Project,Value=${PROJECT}}],Value=${METRIC_VALUE},Unit=None" \
    >/dev/null || {
    echo "ERROR: put-metric-data failed" >&2
    exit 3
  }
fi

MSG="project=${PROJECT} status=${STATUS} snapshot_count=${COUNT} newest=${SNAP_ID:-none} age_hours=${NEWEST_AGE:-n/a} max_age_hours=${MAX_AGE_HOURS}"

if [[ -n "$SNS_TOPIC_ARN" && "$STATUS" != "ok" ]]; then
  "${AWS[@]}" sns publish \
    --topic-arn "$SNS_TOPIC_ARN" \
    --subject "Company Brain snapshot age: ${PROJECT} (${STATUS})" \
    --message "$MSG"$'\n'"Run: scripts/check-snapshot-age.sh --project ${PROJECT} --publish-metric"$'\n'"Runbook: references/runbooks/dlm-restore-drill.md" \
    >/dev/null || {
    echo "ERROR: sns publish failed" >&2
    exit 3
  }
fi

if [[ "$JSON_OUT" -eq 1 ]]; then
  echo "$EVAL"
else
  echo "$MSG"
  if [[ "$PUBLISH_METRIC" -eq 1 ]]; then
    echo "published metric CompanyBrain/Backup NewestSnapshotAgeHours=${METRIC_VALUE} Project=${PROJECT}"
  fi
fi

case "$STATUS" in
  ok) exit 0 ;;
  missing | stale) exit 2 ;;
  *) exit 1 ;;
esac
