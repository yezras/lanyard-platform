# lp-hdzm.31 Mock Lab Stripe residual

**Bead:** `lp-hdzm.31`
**Verdict:** **PASS**
**Fetch:** `stub`
**Authorization logged:** `[REDACTED]`

## 6-tuple

- domain: `stripe.com`
- surface: `openapi` (`api`)
- principal: `tenant`
- auth: `bearer`
- tool: `GET /v1/customers` (`read`)
- paste: `superadmin`

## Checks

- [x] six_tuple
- [x] one_surface
- [x] cp_row
- [x] tool_2xx
- [x] no_token_on_sandbox
- [x] rewake_no_prompt
- [x] member_omit_fail_closed

- CP fingerprint present: `true`
- tool HTTP: `200`
- re-wake HTTP: `200`
- member omit: `403`
- guest files wake: `(none)`
- guest files re-wake: `(none)`
- token leaked: `false`

## Live /admin

- probed: `true`
- `/admin`: `200`
- `/api/admin/auth/me`: `401`
- `/api/admin/tenants`: `401`
- operator email residual: `true`

PLATFORM_OPERATOR_EMAILS / lp-2qs.6 may still block live /admin sign-in. needs_ui_qa.

Live paste through `/admin` is `needs_ui_qa` until lp-2qs.6 sets `PLATFORM_OPERATOR_EMAILS`.
