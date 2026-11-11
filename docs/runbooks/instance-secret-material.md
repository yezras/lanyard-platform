# Instance secret material (durable across CP recycle)

**Bead:** `lp-oop.37.6`  
**Status:** Code + tests landed. Live force-new-deployment proof is **pending** (no terraform apply from this bead).

Live CP used `INSTANCE_SECRET_MATERIAL_PATH=/tmp/control-plane/instance-secret-material.bin` on Fargate. A force-new-deployment wipes `/tmp`. Remaining `guest_gateway` wakes then fail `missing_secret_material`.

This is the **same** AES-256-GCM envelope from `lp-3a1.2` (`createEncryptedFileInstanceSecretMaterialStore`). Do not invent a second store. Put that envelope in Secrets Manager.

## Who still reads the store

| Path | Reads store? |
|------|----------------|
| Vault / Directory / Office when `VaultPlane=cp_s3` | **No** (CP S3; no sandbox wake) |
| Harness bind / `sandbox_create_profile=tool_only` | **No** (create env omits `GATEWAY_RELAY_SECRET`) |
| `guest_gateway` cold create (default) | **Yes** |
| Register / rotate / revoke | **Yes** (put / overwrite / delete) |

Short-stack harness chat does not need guest Relay secrets. Remaining guest hops still do.

## Live cutover (CLI; no EFS)

Do **not** commit secret values. Names and ARNs only.

1. **Keep** existing `INSTANCE_SECRET_MATERIAL_KEY` (ECS secret inject).  
2. **Create** the envelope secret (empty JSON bootstrap — not plaintext instances):

```bash
aws secretsmanager create-secret \
  --name lanyard/staging/portal/control-plane/instance-secret-material \
  --description "Encrypted CP instance secret material envelope (lp-oop.37.6)" \
  --secret-string '{}'
```

3. **Grant the CP task role** (not the execution role) Get + Put on that ARN:

```bash
aws iam put-role-policy \
  --role-name "<control-plane-task-role-name>" \
  --policy-name instance-secret-material-sm \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "InstanceSecretMaterialEnvelope",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:PutSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "<envelope-secret-arn>"
    }]
  }'
```

4. **Task env** (same deploy):

   - Set `INSTANCE_SECRET_MATERIAL_SM_SECRET_ID=<envelope-secret-arn>`
   - **Unset** `INSTANCE_SECRET_MATERIAL_PATH` (resolver fails if both are set)
   - Keep `INSTANCE_SECRET_MATERIAL_KEY` from the secrets map

   Terraform (next operator apply, not this bead): set
   `control_plane_instance_secret_material_sm_secret_arn` on
   `deploy/environments/platform-staging`. Module injects the env id and
   attaches the task-role policy.

5. **Seed** after the new task is healthy: `POST /tenants/{tid}/instances/{iid}/rotate` for each instance that still uses `guest_gateway`.  
6. **Prove:** force-new-deployment the CP service. Guest wake must **not** require another rotate. Boot log `secret_material.kind` = `secrets_manager`, `sm_configured` = true, `path_ephemeral` = false. Never log KEY or envelope body.

Until step 6 is recorded, treat live prove as **pending**. `/tmp` file store still boots (does not take CP down) but is marked `path_ephemeral`.

## Fail-closed

| Config | Result |
|--------|--------|
| SM id + KEY | `secrets_manager` |
| PATH + KEY | `encrypted_file` (`path_ephemeral` if `/tmp`) |
| SM id + PATH | boot fail |
| SM id without KEY | boot fail |
| SM secret missing | get/put fail (`MISSING_MATERIAL_SM_SECRET`) — create the secret first |
| Wrong KEY | decrypt fail (`CORRUPT_MATERIAL_STORE`) |

Never put plaintext relay secrets in Postgres, git, audit logs, or the SM secret string. SM holds ciphertext only.

## Tests

`portal/packages/control-plane/test/gateway-relay-env.test.ts` — fake SM client (no live AWS).  
`portal/packages/control-plane/test/toolbox-bind.test.ts` — `tool_only` does not read the store.
