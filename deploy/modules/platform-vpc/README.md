# platform-vpc

Reusable Terraform module for the **platform VPC foundation** used by Portal compute (P0):

| Resource | Purpose |
|----------|---------|
| VPC (DNS hostnames + support) | Shared platform network |
| ≥2 **public** subnets | Internet-facing BFF / relay ALBs |
| ≥2 **private** subnets | Fargate tasks, **internal** control-plane ALB, RDS |
| Internet gateway + public RT | Public edge default route |
| Optional NAT gateway(s) | Private-subnet general internet egress |
| VPC endpoints | Private AWS API path: **S3**, **ECR** (api+dkr), **CloudWatch Logs**, **Secrets Manager**, **SSM** (+ ssmmessages, ec2messages) |

## Status

| Claim | Truth |
|-------|--------|
| Module is real Terraform | **Yes** — validates with `terraform init -backend=false && terraform validate` |
| Two-AZ public/private topology | **Yes** — enforced (≥2 AZs, ≥2 public, ≥2 private CIDRs) |
| Private subnets reject public IP on launch | **Yes** — hardcode + variable validation + plan checks |
| Applied in platform staging from this repo | **No** — not auto-applied; operator-owned private root |
| Production-certified network | **No** — **infra_ready** only until operator apply + G8/G1 staging evidence |

Readiness: **infra_ready** (`module_status = infra_ready_not_auto_applied`). See `references/readiness-matrix.md` and `references/runbooks/portal-compute-staging-apply.md`.

## Fail-closed posture

- `private_map_public_ip_on_launch` **must** be `false` (variable validation + resource hardcode + `check` + lifecycle precondition).
- Private subnet resources always set `map_public_ip_on_launch = false`.
- Topology requires **≥2** AZs and **≥2** public + **≥2** private subnet CIDRs.
- Private egress check: **NAT** and/or the **full VPC endpoint set** (S3 + ECR + Logs + Secrets Manager + SSM family).
- Interface endpoint SG ingress rejects `0.0.0.0/0` / `::/0` via variable validation (defaults to VPC CIDR).
- `acknowledge_not_auto_applied=true` required so callers do not treat examples as live apply.

## Private egress matrix

| Path | Covers | When to use |
|------|--------|-------------|
| NAT gateway | General internet (mirrors, non-AWS HTTPS) | Staging default; prod often multi-AZ NAT |
| S3 gateway endpoint | Artifact/ECR layer pulls via S3 without NAT | Always recommended |
| ECR API + DKR endpoints | Fargate image pull auth + registry | Required if NAT off for image pull |
| Logs endpoint | CloudWatch Logs from private tasks | Recommended |
| Secrets Manager endpoint | `CONTROL_PLANE_DATABASE_URL` fetch | Recommended for CP tasks |
| SSM / ssmmessages / ec2messages | Session Manager / parameters | Recommended for operator path |

Default example enables **NAT + full endpoint set** (`private_egress_mode = nat_and_endpoints`) with **`single_nat_gateway=true`** (pilot cost path).

Endpoints-only mode (no NAT) is supported when all `enable_*_endpoint` flags are true — suitable for AWS-only private traffic; non-AWS egress will fail without NAT. Running **NAT and** interface endpoints together can **double-pay** for egress plumbing; measure endpoint hourly cost vs single NAT before setting `enable_nat_gateway=false`, and only after the full endpoint set + plan/module egress check are green. **Do not** change the module default of `enable_nat_gateway` without operator proof from a private apply — see `references/runbooks/platform-staging-compose.md` § NAT vs interface endpoints.

## Consumer wiring

```hcl
module "platform_vpc" {
  source = "../../modules/platform-vpc"

  name_prefix = "lanyard-platform-staging"
  environment = "staging"

  vpc_cidr             = "10.0.0.0/16"
  availability_zones   = ["us-east-1a", "us-east-1b"]
  public_subnet_cidrs  = ["10.0.0.0/24", "10.0.1.0/24"]
  private_subnet_cidrs = ["10.0.10.0/24", "10.0.11.0/24"]

  acknowledge_not_auto_applied = true
}

# Public edge ALBs
#   public_subnet_ids = module.platform_vpc.public_subnet_ids
# Private Fargate + internal CP ALB + RDS
#   private_subnet_ids = module.platform_vpc.private_subnet_ids
#   vpc_id             = module.platform_vpc.vpc_id
```

| Consumer | Subnets |
|----------|---------|
| `modules/portal-bff-service` | Public ALB; tasks prefer private |
| `modules/portal-relay-service` | Public ALB; tasks prefer private |
| `modules/portal-control-plane-service` | **Private only** (internal ALB) |
| `modules/control-plane-rds` | **Private only** (`map_public_ip_on_launch=false` required) |

**Do not** attach control-plane or RDS to public subnets.

Prefer **relative** module sources inside this monorepo. External consumers must pin a tag/commit — never `ref=main`.

## Outputs (contract)

| Output | Contents |
|--------|----------|
| `vpc_id` | VPC ID |
| `public_subnet_ids` | Public subnet ID list |
| `private_subnet_ids` | Private subnet ID list |
| `nat_gateway_ids` | NAT IDs (may be empty) |
| `vpc_endpoints_security_group_id` | Interface endpoint SG |
| `s3_gateway_endpoint_id` / `ecr_*` / `logs_endpoint_id` / `secretsmanager_endpoint_id` / `ssm_endpoint_ids` | Endpoint identifiers |
| `vpc_endpoint_ids` | Compact list of created endpoint IDs |
| `private_egress_mode` | `nat` \| `endpoints` \| `nat_and_endpoints` |
| `module_status` | `infra_ready_not_auto_applied` |

## Validate (no credentials / no apply)

```bash
cd modules/platform-vpc
terraform init -backend=false -input=false
terraform validate
```

Offline posture smoke (repo root):

```bash
bash scripts/smoke-platform-vpc.sh
```

## What this does **not** do

| Out of scope | Where it lives |
|--------------|----------------|
| Portal ALB/ECS services | `modules/portal-*` |
| Control-plane RDS | `modules/control-plane-rds` |
| Product artifact S3/ECR landing zone | `modules/product-artifact-infra` |
| Tenant Hermes EC2 VPC | `modules/company-brain-ec2` (per-tenant) |
| Live apply from CI/examples | Operator private root only |

## Honesty

Do **not** claim this module is production-applied or G8 production-certified from presence alone. Keep readiness at **infra_ready** until an operator applies a private root and records staging evidence.
