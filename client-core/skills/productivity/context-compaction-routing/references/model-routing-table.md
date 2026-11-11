# Model Routing Table — Compaction Sub-Agent

Researched via `x_search` on 2026-07-02. **Model names and pricing move
fast — re-verify via `hermes model` (live picker) before hardcoding into a
running pipeline or cron job.** This table is a starting point, not a
frozen contract.

Grounded in this install's actual configured credentials
(`hermes auth list`, checked 2026-07-02):

| Credential | Status |
|---|---|
| `openrouter` | primary provider, default `anthropic/claude-sonnet-5` — was showing `exhausted (402)` at last check; run `hermes auth list` before relying on it for the sub-agent hop too |
| `xai` (API key) + `xai-oauth` (2 creds) | active |
| `openai-codex` (device oauth) + `openai-api` (API key) | active |
| `anthropic`, `google`, `nous` direct | not configured — do not route here unless credentials are added |

## Routing table (best-known picks as of 2026-07-02)

| Primary session provider | Pin compaction sub-agent to | Invocation |
|---|---|---|
| `openrouter` | **DeepSeek V4 Flash** (non-reasoning) — currently the cheapest+fastest high-volume small model on OpenRouter (~$0.09-0.14/M in, $0.18-0.20/M out). Alternative: `google/gemini-3.1-flash-lite` (~$0.25/M in) if you want a non-Chinese-lab option or better quality/cost tradeoff. Use OpenRouter's `~latest` aliases where available (e.g. `~gemini-flash-latest`) to avoid hardcoding a version that gets deprecated. | `hermes chat -q "<prompt>" -m deepseek/deepseek-v4-flash --provider openrouter -t file -Q` |
| `xai` / `xai-oauth` | **Grok 4.1 Fast** — xAI's dedicated cheap/fast tier (~$0.20/M in, $0.50/M out), 2M context. Reuses existing xai-oauth credential. | `hermes chat -q "<prompt>" -m grok-4.1-fast --provider xai-oauth -t file -Q` |
| `openai-codex` (oauth) | **GPT-5.4 Nano** — OpenAI's cheapest dedicated small variant (~$0.20/M in, $1.25/M out), strong intelligence-per-cost. | `hermes chat -q "<prompt>" -m gpt-5.4-nano --provider openai-codex -t file -Q` |
| `openai-api` | Same GPT-5.4 Nano, via direct API key instead of Codex oauth. | `hermes chat -q "<prompt>" -m gpt-5.4-nano --provider openai-api -t file -Q` |
| `anthropic` (direct) — not currently configured | Claude Haiku 4.5 if added later (~$1.00/M in — notably pricier than the above, but higher reliability on tool-use/coding-adjacent filtering tasks). | `hermes chat -q "<prompt>" -m claude-haiku-4.5 --provider anthropic -t file -Q` |
| `google` (direct) — not currently configured | Gemini 3.1 Flash-Lite if added later. | `hermes chat -q "<prompt>" -m gemini-3.1-flash-lite --provider google -t file -Q` |
| `deepseek` — not currently configured | Skip the pattern — deepseek-chat is already cheap/fast enough that the extra hop rarely earns back its latency. | n/a |

## Resolving "current primary provider" at runtime

Visible in the session's model/provider line in the system prompt, or via
`hermes config` (`Model: {'provider': ..., 'default': ...}`). Match on
**provider**, not specific model — the routing decision is per-provider,
since a provider hosts multiple tiers.

## Maintenance

- Re-verify model slugs with `hermes model` before hardcoding into a live
  pipeline or cron job — mini/flash-tier naming turns over every few months.
- If `hermes auth list` shows a provider `exhausted`, the sub-agent call
  will fail the same way the primary session would.
- Update this file only — SKILL.md and the other references shouldn't need
  edits when models change.
