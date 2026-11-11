# Lab Document Server — `lab-shared-compose-ds`

**Bead:** `lp-5q6.25`  
**Topology:** `lab-shared-compose-ds` ([ADR 0006](../../../docs/adr/0006-document-server-topology-and-data-residency.md))  
**License track:** free Community image only ([decision-license-path](../../../docs/plans/0004-portal-onlyoffice-integration/decision-license-path.md))

Docker Compose wiring for a **lab-only** ONLYOFFICE Document Server with JWT enabled. Separate from production Terraform (`lp-5q6.34` staging, per-tenant prod). Fixture/lab data only — never production tenant vault.

## Operator path

Full procedure (resources, ports, env, reachability, smoke, teardown):

→ **[references/runbooks/lab-onlyoffice-document-server.md](../../references/runbooks/lab-onlyoffice-document-server.md)**

## 60-second start

```bash
cd deploy/dev/lab-shared-compose-ds
cp .env.example .env
docker compose up -d
# First start can take 1–3 minutes after image pull
curl -sf "http://127.0.0.1:8080/healthcheck"
curl -sf "http://127.0.0.1:8080/web-apps/apps/api/documents/api.js" | head -c 200
echo
```

Browser: open `http://127.0.0.1:8080/web-apps/apps/api/documents/api.js` — expect JavaScript (DocsAPI loader).

## Offline smoke (CI / no Docker pull)

```bash
bash deploy/scripts/smoke-lab-onlyoffice-compose.sh
```

## Honesty

| Claim | Truth |
|-------|--------|
| Lab JWT + compose for spike | Yes |
| Proves open → edit → callback end-to-end alone | **No** — needs BFF Office routes (`lp-5q6.21`–`.28`) |
| Production / customer vault | **Forbidden** |
| Production Terraform / paid license | **Not** this tree; production DS still blocked |
