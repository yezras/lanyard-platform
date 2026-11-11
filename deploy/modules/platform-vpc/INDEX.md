# platform-vpc

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Two-AZ CIDRs, private IP reject, NAT/endpoints, honesty gate |
| `main.tf` | VPC, public/private subnets, IGW, NAT, route tables, VPC endpoints, fail-closed checks |
| `outputs.tf` | VPC/subnet IDs, NAT, endpoint/SG identifiers, module_status |
| `README.md` | Operator contract, private egress matrix, consumer wiring |
| `terraform.tfvars.example` | Placeholder-only lab CIDRs (not apply-ready) |
