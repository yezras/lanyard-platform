<!-- company-brain-demo-vault -->
# Demo ops runbook

## Host (lab)

1. Prefer **SSM Session Manager** over SSH.
2. Bootstrap: `sudo /usr/local/sbin/company-brain-bootstrap`
3. Seed synthetic vault (this tree): `sudo bash scripts/seed-demo-vault.sh`
4. Confirm gateway: `systemctl status hermes-gateway`

## Vault paths (expected after seed)

- `Projects/Legal/`
- `Projects/Operations/`
- `Knowledge/Company/`
- `Clients/Active/Acme_Demo/`

No secrets belong in this runbook.
