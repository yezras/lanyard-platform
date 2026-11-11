# `@lanyard/connectors`

First-class Portal connector enums (google, hubspot, whatsapp, github) and the host command → `action_class` mapper.

The live connector list is CP `canonical_connectors`, not this catalog. `catalog.json` keeps schema + first-class action classes and the command map.

**Contract SoT:** [`contracts/connectors-v1/`](../../../contracts/connectors-v1/)  
**Design:** [`docs/architecture/portal-connectors.md`](../../../docs/architecture/portal-connectors.md)  
**Bead:** `lp-xhf4.1`

```ts
import {
  classifyCommand,
  parseConnectorId,
  CONNECTOR_IDS,
  ACTION_CLASSES,
} from "@lanyard/connectors";

parseConnectorId("google"); // ok (first-class catalog member)
parseConnectorId("slack"); // throws here — live registry is CP, not catalog.json

classifyCommand(["gws", "gmail", "users", "drafts", "create"]);
// { action_class: "gmail.draft", gate: "sticky", mapped: true }

classifyCommand(["gws", "gmail", "users", "messages", "batchDelete"]);
// { action_class: null, gate: "every_call", mapped: false }

evaluateToolApproval(["gws", "gmail", "users", "drafts", "create"], {});
// prompt Always / Reject (sticky). Later chats with sticky["gmail.draft"] allow.

evaluateToolApproval(["gws", "gmail", "users", "messages", "send"], {});
// prompt Approve this call / Reject. Always is illegal.

decideConnectorChatUse({
  tenant_id, user_id, thread_id,
  connector_id: "google",
  argv: ["gws", "gmail", "users", "messages", "send"],
  connection_status: "not_connected",
});
// needs_auth + pending argv rewritten to drafts.create (lp-xhf4.8)
```

`classifyCommand` takes argv only. It does not take model, prompt, or other LLM input. After `catalog.json` changes, run `pnpm generate` in this package.

WhatsApp pairing (`lp-xhf4.11`): parse `wacli auth --events` stderr NDJSON (`qr_code`), emit reserved `portal_event: "connector.qr"`, and export **only** `session.db`. ASCII QR and the raw code never go to the model. `whatsapp.send` stays `every_call`.

```bash
pnpm --filter @lanyard/connectors test
```
