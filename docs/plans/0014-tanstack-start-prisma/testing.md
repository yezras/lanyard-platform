# 0014 — testing

## Web (TanStack Start SPA)

```bash
pnpm -C portal --filter @lanyard/web test
pnpm -C portal --filter @lanyard/web build
pnpm -C portal pack:web -- --version v0.0.0-start
```

Manual: `/` → `/chat`; Agents / Vault / Tools change the URL; `/?story=document-pane` still renders; `/api/auth/me` still hits the BFF via the Vite proxy on port 3010.

## Prisma

Requires compose Postgres with database `portal_app`:

```bash
docker compose -f portal/docker-compose.yml up -d postgres
# first-time volume: init script creates portal_app. Existing volumes:
#   docker compose exec postgres psql -U portal -c 'CREATE DATABASE portal_app;'
export DATABASE_URL=postgres://portal:portal@127.0.0.1:5432/portal_app
pnpm -C portal --filter @lanyard/db generate
pnpm -C portal --filter @lanyard/db exec prisma validate
pnpm -C portal --filter @lanyard/db migrate
```

## Cognito

BFF integration tests inject an in-memory Cognito fake. Production/lab uses a real user pool via `COGNITO_*` env. Client secret must not appear in plaintext ECS `environment_variables`.
