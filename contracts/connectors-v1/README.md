# Connectors v1 — catalog and command map

**Design:** [docs/architecture/portal-connectors.md](../../docs/architecture/portal-connectors.md) §1, §8, §11  
**Bead:** `lp-xhf4.1` (epic `lp-xhf4`)  
**TypeScript:** `portal/packages/connectors` (`@lanyard/connectors`)

Closed enums and the host command → `action_class` map for Portal connectors. Adding a connector, runtime, or `action_class` is a contract change. Free-text names from config are illegal.

## Files

| Path | Role |
|------|------|
| [`catalog.json`](./catalog.json) | Source of truth: enums, v1 connector rows, gates, command map |
| [`catalog.schema.json`](./catalog.schema.json) | JSON Schema (Draft 2020-12) for `catalog.json` |

## Closed enums

`ConnectorId`: `google` | `hubspot` | `whatsapp`  
`ConnectorRuntime`: `api` | `cli` | `mcp` | `skill`  
`ConnectorPrincipal`: `user` | `tenant`  
`ConnectorAuthKind`: `oauth` | `cli_qr`  
`ActionClass`: `gmail.read` | `gmail.draft` | `gmail.send` | `calendar.read` | `calendar.write` | `drive.read` | `drive.write` | `hubspot.read` | `hubspot.write` | `whatsapp.read` | `whatsapp.send`  
`ActionGate`: `sticky` | `every_call`

GitHub and Outlook are not v1 enum members.

## Command map

Host argv prefix → `action_class`. Longest matching prefix wins. Tokens after the first flag (`-` / `--`) are ignored. The mapper takes argv only; it does not take model or prompt input.

Unmapped command → `unmapped_gate` (`every_call`). Do not run until approved.

## Validation

```bash
python3 scripts/validate-connectors-catalog.py
pnpm -C portal --filter @lanyard/connectors test
```
