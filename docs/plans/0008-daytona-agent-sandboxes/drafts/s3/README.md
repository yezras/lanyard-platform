# S3 vault bucket drafts (design — not applied by this leaf)

**Bead:** `lp-0fq`  
**Normative design:** [../../s3-vault-prefix-layout.md](../../s3-vault-prefix-layout.md)  
**IAM (guest mount):** [../../iam-scoped-s3-mount-policy.md](../../iam-scoped-s3-mount-policy.md) · [../iam/](../iam/)

These files are **resource-policy / bucket-envelope sketches**. They are not Terraform-applied here.

| File | Use |
|------|-----|
| `vault-bucket-policy.json` | Bucket policy: TLS-only, deny public ACLs/grants, optional SSE enforcement on PutObject |

**Always pair with (outside this JSON):**

1. S3 **Block Public Access** — all four settings ON  
2. **Object Ownership = BucketOwnerEnforced** (ACLs disabled)  
3. **Default encryption** — SSE-S3 (pilot) or SSE-KMS platform CMK (prod)  
4. Per-tenant **identity / session** policies from `../iam/` (`lp-t86`) — bucket policy does not isolate tenants alone  

Placeholder: `${LANYARD_VAULT_BUCKET}` (lab example: `lanyard-mocklab-vault-123456789012`).

**Note on SSE denies:** Pilot with SSE-S3 default encryption may omit `DenyUnEncryptedObjectUploads` if clients omit the SSE header but the bucket still encrypts by default. Prefer keeping both statements for SSE-KMS production so puts cannot bypass KMS. Mountpoint compatibility verified in Phase 0 spikes; lab bucket envelope re-checked under `lp-d26`.

Phase 3 apply owners: **`lp-d26` ensure done** for lab mocklab bucket ([pilot-lab-s3-vault-bucket.md](../../pilot-lab-s3-vault-bucket.md)); `lp-t86` (IAM). This draft leaf alone does not attach the policy.
