# Tool placement (short stack)

Canonical doctrine: [docs/architecture/short-stack-tool-placement.md](../../architecture/short-stack-tool-placement.md).

Harness vs toolbox vs platform-then-harness. How to add a tool. Full v1 inventory including cron, MCP, and CLIs.

`web_search`, `parse_document` / `extract_document_text`, and credential-gated `x_search` bind on `createEnvToolsTurnRunner` (`lp-oop.38.12`). Keys stay on the harness task. Guest `tool_only` create-env denylists them.

Beads for the remaining binds live under `lp-oop.38`.
