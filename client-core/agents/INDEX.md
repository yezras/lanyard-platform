# Agents

Agents are well-defined workers that complete repeatable work inside a harness such as Hermes Agent.

Use `template.md` when creating a new agent. Starter agents:

- `vault-writer.md` owns canonical vault mutations and index updates.
- `researcher.md` owns reusable research and artifact drafting.

Optional CRM workflows: enable the `crm` pack and add customer-specific operators after Discover.

Do not put private credentials, customer facts, or live deployment secrets in agent definitions.
