# Channel capabilities (MVP)

Closed set for every Company Brain capability surface:

1. **Lanyard Portal** — relay to Hermes (flagship UX)
2. **Email** — Google Workspace **or** Microsoft 365 (chosen at provision)
3. **Slack**
4. **Microsoft Teams**
5. **WhatsApp** (`wacli` pack)

## Status model

| Status | Meaning |
|--------|---------|
| `configured` | Secrets present; gateway platform registered and healthy |
| `pending_customer` | Capability reserved; awaiting workspace/bot/mailbox credentials |
| `error` | Configured but failing health check |

**Fail closed:** do not register a platform that will only error. Portal may go live first.

## Pack mapping

| Channel | Pack / tooling |
|---------|----------------|
| Portal | Host relay env (`GATEWAY_RELAY_*`) — deploy kit, not this seed |
| Email (Google) | `gws` pack |
| Email (M365) | Host/Hermes M365 gateway setup (docs in deploy kit) |
| Slack / Teams | Hermes native gateway setup |
| WhatsApp | `wacli` pack + linked device |

Secrets never belong in this git repo.
