# workflows/

<!-- mocklab-vault-seed:lp-zuh.9.5 -->

Agent `workflow.definition_roots` points here (`/mnt/vault/workflows`).

- Builtin workflows (e.g. `research-lite`) ship with the agent product.
- Authored definitions land as `{name}.json` under this root (or
  `.lanyard/workflows/` when authoring from vault/project root).

This directory exists so kitchen-sink config has a durable definition root
after S3 mount. Seed includes `research-lite.yaml` so harness settings
snapshot `workflows[]` is not empty (lp-oop.38.18).
