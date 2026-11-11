# Portal production topology (private control-plane boundary)

**Gates:** G0 (path-first topology) · **G1.3** (control plane never on public ALB) · G1.2 (BFF↔CP service auth)  
**Owner:** Portal product (this repo). Deploy modules (company-brain-deploy) consume pins only after product evidence.  
**Status:** Design freeze for the private CP boundary. Live staging proof is **G1.4** (`docs/staging-proofs.md`).

## Principles

1. **BFF is the public API edge** for browser traffic (`/api/*` via CloudFront → public ALB → BFF tasks).
2. **Control plane is private-only.** It must **never** attach to a public Application Load Balancer listener or any internet-facing NLB/API Gateway.
3. **Relay** may expose a controlled public (or edge) WebSocket path for customer gateways; that is separate from the control-plane data plane.
4. **Static web** is S3 + CloudFront OAC — not a long-lived web container on the API ALB.
5. **Service auth (G1.2)** is defense-in-depth on the private network: BFF presents `CONTROL_PLANE_SERVICE_TOKEN`; CP rejects anonymous/spoofed callers even if a network misconfig temporarily widens reachability.

## Target production shape

```
                         Internet
                             │
                     CloudFront (HTTPS)
                      /              \
         static portal-web          /api/* origin
         (S3 OAC)                   public ALB
                                       │
                                   BFF tasks
                                    (private subnets OK;
                                     target of public ALB)
                                       │
                          private service connect only
                                       │
                              ┌────────┴────────┐
                              │  control-plane  │  ← NO public listener
                              │  (private SG /  │
                              │   private ALB   │
                              │   or awsvpc     │
                              │   service disc) │
                              └────────┬────────┘
                                       │
                              relay tasks (WS path
                              as product designs;
                              not a CP public ALB)
```

### Forbidden (fail-closed)

| Pattern | Why forbidden |
|---------|----------------|
| CP target group on **public** ALB | Direct internet reach to tenant admin, instance secrets, RBAC |
| Public NLB/API Gateway → CP | Same |
| Security group `0.0.0.0/0` → CP port `3100` | Public exposure by another name |
| Compose/ECS/K8s Service `type: LoadBalancer` for CP in staging/prod | Accidental public cloud LB |
| Documented “temporary” public CP for debugging in shared staging | Violates G1; use SSM/Tailscale/private VPN instead |

### Required

| Control | Product / compose | Future deploy (G8) |
|---------|-------------------|--------------------|
| CP listen only on private network | Local: host bind `127.0.0.1` or docker network without public publish | Private subnets; SG allows BFF (and relay validate) only |
| No public ALB listener rule for CP | N/A until compute modules exist | Terraform/module tests must reject public CP attachment |
| BFF→CP service token | `CONTROL_PLANE_SERVICE_TOKEN` on both | Same secret from SSM/Secrets Manager / GitHub Environments |
| Production auth mode | `CONTROL_PLANE_AUTH_MODE=production` | Task env |

## Local / compose (this repo)

`docker-compose.yml` is a **developer smoke stack**, not production topology.

| Service | Host publish | Intent |
|---------|--------------|--------|
| `bff` | `4000` | Local browser/API edge stand-in |
| `relay` | `8787` | Local gateway WS stand-in |
| `control-plane` | **`127.0.0.1:3100` only** | Loopback-only; not `0.0.0.0` host bind |

- CP is on the compose **internal** network so BFF reaches `http://control-plane:3100`.
- Host port mapping is **loopback-bound** so the service is not advertised on LAN interfaces.
- `scripts/docker-smoke.sh` also publishes CP as `127.0.0.1:${SMOKE_CP_PORT}`.

Automated checks:

- `packages/control-plane/test/private-topology.test.ts` (compose + smoke script + ADR assertions)
- `bash scripts/local-topology-proof.sh` (shell fail-closed local harness)

## Fail-closed design for future deploy modules (G8)

When company-brain-deploy (or this repo) adds ECS/ALB modules:

1. **Separate target groups:** public ALB may target **BFF** (and optionally relay WS) only.
2. **CP service:** private subnet + SG ingress from BFF task SG (and relay if validate is used) **only**. Prefer service discovery / private ALB internal scheme `internal`.
3. **Module guardrails (required when modules land):**
   - Input variable `control_plane_public_alb = true` must **error** (validation block).
   - Unit test / `terraform test` / policy-as-code: no `aws_lb_listener` / rule may forward to CP target group on an internet-facing LB.
   - README non-claim: do not mark G1 ready without product evidence links.
4. **Do not** invent working public CP “for staging convenience.” Staging proves **private** CP (G1.4).

## Credentials (document names only — never commit values)

| Env / GitHub Secret name | Where | Purpose |
|--------------------------|-------|---------|
| `CONTROL_PLANE_SERVICE_TOKEN` | BFF + CP tasks | G1.2 mutual service credential |
| `INTERNAL_OPS_TOKEN` | CP (+ optional ops runners) | Elevated retention / relay-tier ops |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | CP (and BFF as needed) | G1.1 OIDC |
| `CONTROL_PLANE_AUTH_MODE=production` | CP | Fail-closed app gate |

**Rotation (service token):** mint ≥32-byte random secret → dual-write to BFF and CP secret stores → redeploy CP then BFF (or both rolling) → retire old value. See `packages/control-plane/README.md` § Service credential rotation.

## Related

- G1.1 OIDC: `packages/control-plane/src/google-auth.ts`, `test/oidc-production.integration.test.ts`
- G1.2 service auth: `packages/control-plane/src/service-auth.ts`, `test/service-auth.integration.test.ts`
- G1.4 / G3.4 staging harness: `docs/staging-proofs.md`
- Readiness (deploy repo): `references/readiness-matrix.md` G1 row (**stays blocked** until live staging evidence is recorded by operators)
