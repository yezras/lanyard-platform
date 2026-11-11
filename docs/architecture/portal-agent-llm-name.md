# Portal agent LLM name (lp-fn5.3.4 / lp-lv9.3 / lp-pxr.2 / lp-7st.1)

**Status:** implemented (C4 + eager bootstrap + first-message model title + neutral offline fallback)  
**Epic:** lp-fn5.3 agent identity (avatar_seed + title_source + rename); lp-lv9 Agents v2; polish lp-pxr.2; bugfix lp-7st.1

## Goal

Each interactive chat agent gets a **generic title** eagerly on create
(bootstrap / empty context → `"New agent"`), then a **model-invented short name**
after the first user message when the title is still system-owned (`default` or
prior `llm`). User renames and job stream titles are sticky.

## Name brief (product contract — lp-pxr.2 / lp-7st.1)

Agent display names are **codenames that fit purpose**, not prompt excerpts.
Creative names come from the **host model** via `chat.suggest_title` — not from
a product offline keyword map.

| Rule | Guidance |
| --- | --- |
| Length | **1–3 words** (prefer a single evocative word when possible) |
| Style | Creative / purpose-fitting (model invents; e.g. may choose any short evocative word) |
| Forbidden | Paraphrase of the user message; first-N-words snippets; full sentences; product keyword maps that force sales → Hound |
| Format | No wrapping quotes; no trailing sentence punctuation |
| Max chars | 48 (sanitize / PATCH title max) |

Real creative quality depends on the **host model** + the BFF-supplied
instruction. Offline fixture uses a **neutral deterministic hash pool** only
(cannot invent freely without a model; never maps domain keywords to fixed
names like Hound/Scout).

## Fields (C1)

| Field | Values | Notes |
| --- | --- | --- |
| `title` | string | Agent display name in side nav / header |
| `title_source` | `default` \| `llm` \| `user` \| `job` | Provenance; LLM never overwrites `user` or `job` |
| `avatar_seed` | string | Unrelated to rename (stable dither skin) |

Create still uses temporary title `"New chat"` (or project name) with
`title_source: default`.

## Contract

### `POST /api/chat/threads/:threadId/assign-name`

**Auth:** session + CSRF; **owner only** (same as PATCH title).

**Request body:**

```json
{
  "message": "optional first user message for context"
}
```

**Response** (200):

```json
{
  "thread_id": "…",
  "title": "Orbit",
  "project_id": null,
  "project_vault_path": null,
  "created_at": "…",
  "avatar_seed": "…",
  "title_source": "llm",
  "applied": true,
  "name_source": "fixture",
  "skipped_reason": null
}
```

| Field | Meaning |
| --- | --- |
| `applied` | `true` when title was written with `title_source=llm` |
| `name_source` | `host` (Brain RPC) or `fixture` (offline/mock); `null` if skipped |
| `skipped_reason` | `title_source` when sticky `user`/`job` blocked apply; else `null` |

**Policy:**

1. If `title_source` is `user` or `job` → return current thread, `applied: false`.
2. **Bootstrap** (empty / whitespace `message`): always `"New agent"` (fixture);
   apply only when `title_source` is still `default`. No host RPC on bootstrap.
3. **Refine** (non-empty `message`): apply when `title_source` is `default|llm`.
   Prefer host `chat.suggest_title` when `BRAIN_RPC_ENABLED`; else neutral
   offline hash-pool fixture.
4. `assignLlmTitle` → `title_source=llm`.

### Name resolution

```
if bootstrap (empty message):
  "New agent" → name_source=fixture   // no host, no keyword map
else:
  if brainRpcEnabled:
    try Brain RPC method chat.suggest_title
         params: {
           thread_id,
           message,
           instruction: <CHAT_SUGGEST_TITLE_PROMPT>,  // invent codename brief
           prompt: <same brief>                       // alias for hosts
         }
         result: { title: string }  // or { name: string }
    on success with non-empty sanitized title → name_source=host
  if no host title:
    fixtureAgentNameFromMessage(message) → name_source=fixture
    // deterministic pick from OFFLINE_CODENAME_FALLBACKS (Atlas, Orbit, …)
```

- **Sanitize:** trim, collapse whitespace, strip wrapping quotes, first-clause
  if the model returned a sentence, cap to **3 words** and 48 chars.
- **Host prompt (`CHAT_SUGGEST_TITLE_PROMPT`):** asks the model to invent a
  creative 1–3 word codename that fits purpose; explicitly forbids prompt
  paraphrase / first words. Does **not** prescribe fixed domain → name mappings.
- **Offline fixture (lp-7st.1):** neutral hash pool only (`Atlas`, `Orbit`, …).
  **No** product keyword map (sales/pipeline must not always become `Hound`).
  **Not** first-N-words of the message. Empty message → `"New agent"`.
- **Mock-gateway** (local demo with brain RPC on): returns
  `{ "title": "Mock Lab Agent" }` for `chat.suggest_title` (deterministic lab
  label; ignores message text). **Live hosts must implement model-backed
  suggest_title** — the mock is not product naming quality.

### Client timing (lp-lv9.3)

1. **Eager on create** — after interactive `POST …/threads` succeeds, client
   fires `POST …/assign-name` with empty `message` (bootstrap). Does not block
   the composer. Result is always generic `"New agent"`.
2. **Refine after first user message** — when `POST …/messages` succeeds and
   `title_source` is still `default|llm`, client calls assign-name once per
   thread with the message text (session guard). Host model invents the name
   when brain RPC is available; may overwrite bootstrap `llm` title; never
   `user` or `job`.
3. Side nav updates when `applied: true`.

Explicit rename (`PATCH` with `title_source: user`, C3) must not be overwritten
by a later assign-name.

### SideNav subtitle (lp-lv9.3)

Line 2 of the agent row is a **truncated latest user/assistant preview**
(session-local from the chat timeline), not a second model call. Falls back to
a short created-at activity proxy when no preview is available
(`agentSideNavSubtitle` + `truncateThreadTitle`).

### Related

- C1: `avatar_seed` + `title_source` on store / API (`lp-fn5.3.1`)
- C3: double-click rename sets `title_source=user` (`lp-fn5.3.3`)
- Subtitle ellipsis uses `truncateThreadTitle` (not the LLM name path)
- Creative codenames (not prompt snippets): `lp-pxr.2`
- Stop offline keyword map (Hound): `lp-7st.1`
