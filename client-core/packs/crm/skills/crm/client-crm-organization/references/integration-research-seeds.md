# Integration research seeds (RFP stacks)

Condensed pointers for agent `web_search` when writing the **Materials proposal** architecture section. **Verify** with client edition, BAA, and vendor before proposals.

| System | Typical integration angles |
|--------|---------------------------|
| **3CX** | Call Control API (Hermes orchestrates via integration service — not SIP-native Hermes); AI Edition / SIP extension for live STT↔agent↔TTS; Adnet/report exports for KPI cron. **Default 3CX-only** when client PBX is 3CX (do not add Twilio unless asked). |
| **Salesforce** | REST/Bulk API; Salesforce-hosted MCP (OAuth PKCE); community jsforce MCP servers; web-to-lead boundary for proprietary sites |
| **legacy EMR** | Vendor-led integrations; often slow/brittle per client; treat public marketing “CRM connect” separately from API reality |
| **Doxy.me** | EHR integration docs, embeddable SDK, scheduling partners; usually link-out from EMR not intake API |
| **Azalea** | SMART on FHIR API marketplace; Postman public API |
| **Zendesk** | REST API; optional chat transcript → CRM notes |
| **Acuity Scheduling** | Scheduling API for narrow fin-consult flows |
| **Microsoft Outlook** | Graph / enterprise mail for voicemail-folder triage (PHI-safe handling in vault) |

Phase 1 default when client reports painful EMR integrations: **qualify + CRM tasks**, defer EMR booking automation.