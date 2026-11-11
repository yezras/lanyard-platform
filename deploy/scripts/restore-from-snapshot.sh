#!/usr/bin/env bash
# Operator automation: restore Company Brain disk state from a DLM EBS snapshot.
#
# Default is dry-run (print plan only). Pass --execute to create AWS resources.
# Prefer SSM Session Manager for host access (not public SSH). See:
#   references/runbooks/dlm-restore-drill.md
#   references/runbooks/ssm-break-glass.md
#
# Modes:
#   ami    — register a temporary AMI from the snapshot (root-disk style recovery)
#   volume — create a new EBS volume from the snapshot (attach to recovery host)
#
# Usage:
#   bash scripts/restore-from-snapshot.sh \
#     --project acme-brain --snapshot-id snap-REPLACE --region us-east-1 --az us-east-1a
#   bash scripts/restore-from-snapshot.sh \
#     --project acme-brain --snapshot-id snap-REPLACE --mode volume --az us-east-1a --execute
#   bash scripts/restore-from-snapshot.sh \
#     --project acme-brain --pick-newest --mode ami --az us-east-1a
#
# After launch, verify artifact pins on host (do not git-clone vault content):
#   sudo cat /etc/company-brain/artifact-pins.env
#   sudo /usr/local/sbin/company-brain-bootstrap   # only if AGENTS.md missing (seed gate)
set -euo pipefail

PROJECT=""
SNAPSHOT_ID=""
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
AZ=""
MODE="volume"
EXECUTE=0
PICK_NEWEST=0
NAME_SUFFIX="restore-$(date -u +%Y%m%dT%H%M%SZ)"
INSTANCE_ID=""
VERIFY_PINS_HINT=1

usage() {
  sed -n '2,28p' "$0" | sed 's/^# \?//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT="${2:-}"
      shift 2
      ;;
    --snapshot-id)
      SNAPSHOT_ID="${2:-}"
      shift 2
      ;;
    --pick-newest)
      PICK_NEWEST=1
      shift
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --az)
      AZ="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --execute)
      EXECUTE=1
      shift
      ;;
    --name-suffix)
      NAME_SUFFIX="${2:-}"
      shift 2
      ;;
    --instance-id)
      INSTANCE_ID="${2:-}"
      shift 2
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

if [[ "$MODE" != "ami" && "$MODE" != "volume" ]]; then
  echo "ERROR: --mode must be ami or volume" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "ERROR: aws CLI not found" >&2
  exit 1
fi

AWS=(aws)
if [[ -n "$REGION" ]]; then
  AWS+=(--region "$REGION")
fi

if [[ "$PICK_NEWEST" -eq 1 && -z "$SNAPSHOT_ID" ]]; then
  SNAPSHOT_ID="$("${AWS[@]}" ec2 describe-snapshots \
    --owner-ids self \
    --filters Name=tag:Project,Values="$PROJECT" Name=tag:Backup,Values=daily Name=status,Values=completed \
    --query 'sort_by(Snapshots,&StartTime)[-1].SnapshotId' \
    --output text 2>/dev/null || true)"
  if [[ -z "$SNAPSHOT_ID" || "$SNAPSHOT_ID" == "None" ]]; then
    echo "ERROR: no completed snapshots found for Project=${PROJECT} Backup=daily" >&2
    exit 2
  fi
  echo "Picked newest snapshot: $SNAPSHOT_ID"
fi

if [[ -z "$SNAPSHOT_ID" ]]; then
  echo "ERROR: --snapshot-id or --pick-newest is required" >&2
  usage
fi

SNAP_META="$("${AWS[@]}" ec2 describe-snapshots \
  --snapshot-ids "$SNAPSHOT_ID" \
  --query 'Snapshots[0].{Id:SnapshotId,State:State,StartTime:StartTime,VolumeSize:VolumeSize,Encrypted:Encrypted,KmsKeyId:KmsKeyId,VolumeId:VolumeId}' \
  --output json)"

SNAP_STATE="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("State") or "")' <<<"$SNAP_META")"
VOL_SIZE="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("VolumeSize") or "")' <<<"$SNAP_META")"
START_TIME="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("StartTime") or "")' <<<"$SNAP_META")"
ENCRYPTED="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("Encrypted"))' <<<"$SNAP_META")"
KMS_KEY="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("KmsKeyId") or "")' <<<"$SNAP_META")"

if [[ "$SNAP_STATE" != "completed" ]]; then
  echo "ERROR: snapshot $SNAPSHOT_ID state is '${SNAP_STATE}' (need completed)" >&2
  exit 2
fi

if [[ "$MODE" == "volume" && -z "$AZ" ]]; then
  echo "ERROR: --az is required for --mode volume (must match recovery instance AZ)" >&2
  exit 1
fi

TAG_SPEC_NAME="${PROJECT}-hermes-${NAME_SUFFIX}"

echo "=== Restore plan (project=${PROJECT}) ==="
echo "snapshot_id:  $SNAPSHOT_ID"
echo "start_time:   $START_TIME"
echo "volume_size:  ${VOL_SIZE} GiB"
echo "encrypted:    $ENCRYPTED"
echo "kms_key:      ${KMS_KEY:-"(volume default / AWS managed)"}"
echo "mode:         $MODE"
echo "az:           ${AZ:-"(n/a for ami register)"}"
echo "execute:      $EXECUTE"
echo "name:         $TAG_SPEC_NAME"
echo

if [[ "$EXECUTE" -ne 1 ]]; then
  echo "DRY-RUN only. Re-run with --execute to create resources."
  echo
  if [[ "$MODE" == "volume" ]]; then
    echo "Would create volume from snapshot in $AZ, tags Project=${PROJECT} Role=company-brain-restore."
  else
    echo "Would register AMI from snapshot (x86_64, EBS root /dev/xvda), tags Project=${PROJECT}."
  fi
  echo
  echo "After resources exist:"
  echo "  1. Launch recovery EC2 in private subnet (prefer templates/tenant or break-glass AMI)."
  echo "  2. Access via SSM (not public SSH):"
  echo "       aws ssm start-session --target <instance-id>${REGION:+ --region $REGION}"
  echo "  3. Verify pins: sudo cat /etc/company-brain/artifact-pins.env"
  echo "  4. Mount/verify vault paths; do NOT re-extract client-core if AGENTS.md exists."
  echo "  5. Smoke Hermes; record RTO in private ops store (see dlm-restore-drill.md)."
  echo "  6. Tear down recovery resources or promote per change control."
  exit 0
fi

CREATED_ID=""
CREATED_TYPE=""

if [[ "$MODE" == "volume" ]]; then
  echo "Creating volume from $SNAPSHOT_ID in $AZ ..."
  CREATED_ID="$("${AWS[@]}" ec2 create-volume \
    --snapshot-id "$SNAPSHOT_ID" \
    --availability-zone "$AZ" \
    --volume-type gp3 \
    --tag-specifications "ResourceType=volume,Tags=[{Key=Name,Value=${TAG_SPEC_NAME}},{Key=Project,Value=${PROJECT}},{Key=Role,Value=company-brain-restore},{Key=Backup,Value=restore-drill}]" \
    --query 'VolumeId' \
    --output text)"
  CREATED_TYPE="volume"
  echo "Created volume: $CREATED_ID"
  echo "Wait for available ..."
  "${AWS[@]}" ec2 wait volume-available --volume-ids "$CREATED_ID"
  if [[ -n "$INSTANCE_ID" ]]; then
    echo "Attaching $CREATED_ID to $INSTANCE_ID as /dev/xvdf ..."
    "${AWS[@]}" ec2 attach-volume \
      --volume-id "$CREATED_ID" \
      --instance-id "$INSTANCE_ID" \
      --device /dev/xvdf >/dev/null
    echo "Attached. On host (SSM): sudo mkdir -p /mnt/restore && sudo mount /dev/xvdf /mnt/restore  # adjust device/fs"
  else
    echo "No --instance-id: attach manually to a recovery host in $AZ."
  fi
else
  echo "Registering AMI from $SNAPSHOT_ID ..."
  # Architecture defaults to x86_64 (module default instance families). Override AMI later if needed.
  CREATED_ID="$("${AWS[@]}" ec2 register-image \
    --name "$TAG_SPEC_NAME" \
    --description "Company Brain restore from ${SNAPSHOT_ID} (${PROJECT})" \
    --architecture x86_64 \
    --virtualization-type hvm \
    --root-device-name /dev/xvda \
    --block-device-mappings "DeviceName=/dev/xvda,Ebs={SnapshotId=${SNAPSHOT_ID},VolumeType=gp3,DeleteOnTermination=true}" \
    --ena-support \
    --query 'ImageId' \
    --output text)"
  CREATED_TYPE="ami"
  echo "Registered AMI: $CREATED_ID"
  "${AWS[@]}" ec2 create-tags \
    --resources "$CREATED_ID" \
    --tags "Key=Name,Value=${TAG_SPEC_NAME}" "Key=Project,Value=${PROJECT}" "Key=Role,Value=company-brain-restore" "Key=SourceSnapshot,Value=${SNAPSHOT_ID}" \
    >/dev/null || true
  echo "Set ami_id = \"$CREATED_ID\" in recovery tfvars (or launch break-glass instance from this AMI)."
  echo "Prefer private subnet + enable_ssm_access; do not open SSH to 0.0.0.0/0."
fi

echo
echo "=== Post-create verification checklist ==="
echo "resource_type: $CREATED_TYPE"
echo "resource_id:   $CREATED_ID"
echo "snapshot_id:   $SNAPSHOT_ID"
echo "project:       $PROJECT"
echo
echo "SSM access (preferred):"
if [[ -n "$INSTANCE_ID" ]]; then
  echo "  aws ssm start-session --target ${INSTANCE_ID}${REGION:+ --region $REGION}"
else
  echo "  aws ssm start-session --target <recovery-instance-id>${REGION:+ --region $REGION}"
fi
echo
if [[ "$VERIFY_PINS_HINT" -eq 1 ]]; then
  cat <<'EOF'
On recovery host:
  sudo test -f /etc/company-brain/artifact-pins.env && sudo cat /etc/company-brain/artifact-pins.env
  # Compare URL/version/SHA-256 to tenant terraform.tfvars / compatibility pins (private notes)
  sudo test -f /opt/company-brain/AGENTS.md && echo "seed present — do not re-extract client-core"
  # Only if AGENTS.md missing:
  #   sudo /usr/local/sbin/company-brain-bootstrap
  # Hermes smoke:
  #   sudo -u ec2-user /opt/hermes-lanyard/bin/hermes doctor   # path may vary

Record in private ops store (not git): start UTC, end UTC, snapshot age, RTO hours, issues.
Target examples: RPO 24h (daily DLM), RTO 4h (drill goal). See dlm-restore-drill.md.
EOF
fi
