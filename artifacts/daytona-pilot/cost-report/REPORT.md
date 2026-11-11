# lp-zuh.14.1 — Cost report evidence pack

**Bead:** `lp-zuh.14.1` — Cost report: Daytona vCPU-hours vs prior EC2 estimate  
**Supersedes tracking:** `lp-iy2` (close when this lands)  
**Canonical plan doc:** [`docs/plans/0008-daytona-agent-sandboxes/cost-report-daytona-vs-ec2.md`](../../../docs/plans/0008-daytona-agent-sandboxes/cost-report-daytona-vs-ec2.md)  
**Date:** 2026-08-19

## Acceptance

| # | Criterion | Result |
|---|-----------|--------|
| 1 | Report with numbers for pilot usage (2 h/day active vs always-on EC2) | **GO** — summary table below; full math in plan doc §§4–7 |
| 2 | Linked from `docs/plans/0008-daytona-agent-sandboxes/` | **GO** — plan doc + overview + issue-map links |
| 3 | Confirms stop/idle path (not always-on); cite `lp-8sn` / `lp-kva` | **GO** — § Stop path + sources |
| 4 | Evidence under `artifacts/daytona-pilot/cost-report/` | **GO** — this pack |

## Head-to-head summary (one pilot tenant / month)

| Line | Always-on EC2 `t3.medium` | Daytona thrifty (2 h/day + 10m idle grace) |
|------|---------------------------|---------------------------------------------|
| Online hours / mo | **730** | **65** |
| vCPU-hours (1 vCPU proxy) | 1,460 | **65** (~22× fewer) |
| vCPU-hours (2 vCPU parity) | 1,460 | **130** (~11× fewer) |
| Approx $ (public list) | **~$34** | **~$6–12** |
| Idle stop? | No | **Yes** (CP reaper 10m + vendor autoStop 90m) |

Rates are **illustrative public list** (EC2 us-east-1 On-Demand `t3.medium` ~$0.0416/h; Daytona ~$0.0504/vCPU-h + ~$0.0162/GiB-h). Not a contracted quote.

## Stop / idle path confirmation

| Proof | What it shows |
|-------|----------------|
| `lp-8sn` (closed 2026-08-06) | MockLab sandbox `71ef3a01` **stopped**; re-wake same `sandbox_id`, `wake_ms≈1082` (`start_from_stopped`); chat 200 after re-wake |
| `lp-cbv` | Offline real-harness wake → idle stop → re-wake CI tests — [`fake-daytona-wake-stop-rewake.md`](../../../docs/plans/0008-daytona-agent-sandboxes/fake-daytona-wake-stop-rewake.md) |
| `lp-0y3` / `lp-kng.8` | Primary cost control: **10 min** idle reaper — [`idle-reaper.md`](../../../docs/plans/0008-daytona-agent-sandboxes/idle-reaper.md) |
| `lp-4f2` | Vendor autoStop **90m** backstop — [`daytona-autostop-safety-net.md`](../../../docs/plans/0008-daytona-agent-sandboxes/daytona-autostop-safety-net.md) |
| `lp-kva` | Started-hours / vCPU-hours queries + always-on misconfig alerts — PR [#329](https://github.com/LanyardBrain/lanyard-platform/pull/329); metrics [`sandbox-orchestrator-metrics.md`](../../../docs/plans/0008-daytona-agent-sandboxes/sandbox-orchestrator-metrics.md) |

**Misconfig:** Daytona left always-on (~720 started-h/mo) can cost **more** than always-on EC2 on public list rates — thrift requires the stop path.

## Files

| File | Role |
|------|------|
| `REPORT.md` | This evidence summary |
| Plan doc (linked above) | Full formulas, sensitivity, EC2/Daytona sketches, acceptance map |
