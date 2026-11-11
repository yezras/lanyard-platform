# Testing — Portal agent-backend parity (monorepo)

**Back-link:** [overview.md](./overview.md)

## Per-phase matrix

| Phase | Static | Runtime |
| --- | --- | --- |
| 1 De-Hermes paths | unit: home resolve, preferred paths | BFF with BACKEND_HOME only |
| 2 Settings RPC + hide | settings-bff, web nav visibility | fake backend partial capabilities |
| 3 Projects stamp | projects-bff, chat stamp | fake two-project select |
| 4 Composer inventory | trigger source tests, no stubs | fixture skills list |
| 5 Office preview | renderer tests, grep no desktop open | UI story/screenshot Office types |
| 6 Joint GO | evidence schema validate | Docker mocklab + real LA |

## Commands (local)

```bash
# Portal packages (adjust filters as phases land)
cd portal && pnpm test --filter @lanyard/backend-runtime
cd portal && pnpm test --filter @lanyard/web-settings-schema
cd portal/packages/bff && pnpm test
cd portal/packages/web && pnpm test

# Joint GO (phase 6) — Docker mocklab + real Lanyard Agent
bash deploy/scripts/prove-mocklab-agent-parity.sh
# Evidence: artifacts/mocklab/lp-rt5/joint-go-evidence-latest.json (joint_go=GO)
# Topology: docs/architecture/mocklab-agent-parity-topology.md
```

## Joint GO required checks

1. `backend.kind == lanyard_agent` in evidence
2. `settings.sections_match_capabilities`
3. `projects.list_nonempty` (or honest empty if seed has zero — seed should include ≥1)
4. `chat.working_directory_stamped`
5. `composer.skills_from_host`
6. `composer.no_default_agent_stubs`
7. `office.preview_inline_docx` (and xlsx/pptx)
8. `office.no_unsupported_placeholder`
9. `host.sandbox_enforced` (agent-side check or negative path probe)
10. `hermes_lanyard.regression` row (separate or same matrix)

## Sandbox residual honesty (lp-uxy.6)

File-tool path ACL negatives are automated; LA bash is **not** a hard jail.
Report + probes:

```bash
python3 deploy/scripts/omnibox/test-project-path-escape.py
bash deploy/scripts/prove-sandbox-path-acl.sh
# docs/security/lp-uxy.6-agent-sandbox-path-acl-omnibox.md
```

## Non-claims

- Not AWS staging / production OnlyOffice
- Not third harness (Codex/OpenCode/Pi)
- Not CP project store unification
