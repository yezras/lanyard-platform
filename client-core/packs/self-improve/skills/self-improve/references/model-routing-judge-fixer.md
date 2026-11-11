# Judge & fixer model routing (self-improve subprocesses)

The nightly **cron runner** stays on `grok-composer-2.5-fast` + `xai-oauth` (tool-heavy orchestration).

**Judge** (Phase 5) and **fixer** (Phase 6) run as isolated `hermes chat -q` subprocesses on a stronger model. Pin **Grok 4.3** when `xai-oauth` is available:

```bash
hermes chat -q "[self-improve-internal]
<rubric + episode JSON here>" \
  -m grok-4.3 \
  --provider xai-oauth \
  -t file \
  -Q
```

Rules:

- First line of the prompt must include `[self-improve-internal]` so the next night's run excludes this session.
- Pass episode transcript + `features_json` + `references/judge-rubric.md` contract for judge calls.
- For fixer calls, include attribution, component path, and tier table from `SKILL.md`.
- If `xai-oauth` is unavailable, stop and report in the morning Slack digest — do not fall back to an unpinned model silently.

Re-verify model slug with `hermes model` periodically; update this file when xAI renames tiers.