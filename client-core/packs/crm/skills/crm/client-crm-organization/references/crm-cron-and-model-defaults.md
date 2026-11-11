# CRM Cron Jobs and Model Defaults (Lanyard)

Canonical defaults for all Lanyard CRM scheduled jobs. Child skills (`post-meeting-triage`, `weekly-client-refresh`, `daily-client-task-update`) should point here instead of duplicating.

## Runner model (required pin)

Pin on every CRM cron via `cronjob` `action=update` or at create time:

```json
"model": { "provider": "xai-oauth", "model": "grok-composer-2.5-fast" }
```

Matches `~/.hermes/config.yaml` (`model.default` + `model.provider`).

**Pitfall — do not confuse two different uses of Grok:**
- **Runner model:** The scheduled Hermes agent session may use Grok via xai-oauth. That is correct and required for tool-heavy CRM crons.
- **Tool delegation:** Do **not** route Granola/Gmail/WhatsApp/CRM filing through `grok` CLI, `escalate-to-grok`, or `codex`. Use native `mcp_granola_*`, gws, and `wacli` on that same runner. See `references/native-tools-policy.md`.

## Registered jobs (verify with `cronjob action=list`)

| Name | Typical schedule | Skills (no `codex`) |
|------|------------------|---------------------|
| `daily-client-task-update` | `0 8 * * 1-5` | `daily-client-task-update` |
| `weekly-crm-refresh` | `0 9 * * 0` | `weekly-client-refresh`, `client-crm-organization`, `gws-gmail`, `gws-calendar`, `wacli` |
| `post-meeting-triage-cron` | `0 12,17 * * 1-5` | `post-meeting-triage`, `client-crm-organization`, `gws-gmail`, `gws-calendar`, `gws-calendar-agenda` |

Granola: built-in `mcp_granola_*` tools — **not** a skill name in the `skills` array.

## Skill library layout

CRM workflows live under `~/.hermes/skills/crm/` (not `note-taking/`). `obsidian` remains under `note-taking/`.

## gws auth recovery

If gws hits `invalid_rapt` / reauth loops:

```bash
rm -f ~/.config/gws/token_cache.json ~/.config/gws/credentials.enc
gws auth
```

Project ID: `lanyard-spark-agent`.

## Applying approved post-meeting-triage writes

When a post-meeting triage cron says “Proposed CRM writes (await YES)” and the user replies “YES” / “make the proposed updates,” do not re-ask. Apply the proposed writes in the interactive session.

Minimum sequence:

1. Read vault + client `AGENTS.md` guidance and the target clients’ existing note conventions.
2. Use the canonical DB at `<VaultRoot>/Clients/clients_crm.db` (not `<VaultRoot>/clients_crm.db`, which may be an empty placeholder).
3. Verify the schema before inserts. Current `communications.method` is constrained to `whatsapp`, `gmail`, `zoom`, `in_person`, or `other`; record phone calls as `other` unless/until the schema adds `phone`.
4. Verify contacts by email/name before trusting IDs from cron output. If a contact exists under a stale or missing `client_id`, repair linkage only after confirming the matching client folder/notes history.
5. Write the requested notes under the correct client `notes/` directory with standard frontmatter (`date`, `from`, `subject`, `client`) and update the client root `AGENTS.md` next steps/contact details to match DB truth.
6. Insert `communications` rows and update each touched client’s `last_communication_at`, `next_step`, `recent_granola_summary`, and `brief_meeting_note` when available.
7. Run `cd <VaultRoot> && ob sync`; then mine the touched client wing if the job/user specifically requested MemPalace refresh.

## ob sync

After Markdown changes under `<VaultRoot>/Clients/`:

```bash
cd <VaultRoot> && ob sync
```

If `ob sync` reports missing sync config, vault sync may be unset on this host — fix `ob sync-setup` separately; do not skip filing work for that reason alone.

If a second `ob sync` immediately after the first reports *another sync instance is already running*, treat the hygiene pass as complete when the first run exited 0.