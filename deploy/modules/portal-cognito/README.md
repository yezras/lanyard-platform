# portal-cognito

Cognito User Pool for Portal **password** sign-in (ADR 0010). The BFF authenticates server-side with `ADMIN_USER_PASSWORD_AUTH` and then issues `lanyard_session`. Hosted UI is not enabled.

**Status:** infra_ready — not auto-applied.

## Outputs to BFF

| Env | Source |
|-----|--------|
| `COGNITO_USER_POOL_ID` | `user_pool_id` (plain env OK) |
| `COGNITO_CLIENT_ID` | `client_id` (plain env OK) |
| `COGNITO_REGION` | AWS region of the pool |
| `COGNITO_CLIENT_SECRET` | `client_secret` via Secrets Manager / BFF `secrets` map only |

## Honesty

`acknowledge_not_auto_applied = true` is required to plan.
