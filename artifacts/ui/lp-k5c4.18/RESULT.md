# lp-k5c4.18 mailbox runner — both-rooms proof

**Branch:** `beads/lp-k5c4.18-mailbox-runner`  
**Bead:** Mailbox icon without target inbound (tools runner + prove Drift 1:1)

## What was broken
Jack tells Cipher to message Drift. Origin shows Messaged @Drift chrome but Drift 1:1 stays empty (no-tools runner). Local `createEnvLiteLlmTurnRunner` could not call `mailbox.send`; BFF had hop chrome but no tools-capable path.

## Fix (lac-r9w contract)

- **Tools-capable runner:** `POST /internal/mailbox/send` with `x-harness-service-token` (same as harness turns). Model never POSTs `/api/*` directly. Tool input matches `contracts/mailbox-v1` (`{to, room, text, nonce}` + stamps `{from, tenant_id}`).
- **Origin + target paired:** `applyMailboxHop` paints `system_notice: A message has been sent to Drift.` on origin (Cipher) 1:1, mints Jack↔Drift if missing, and builds `mailboxHopWakePayload` with `metadata.hidden_instruction` + `room_tail` (40 max) for the target.
- **Target enqueue:** `harnessClient.startTurn` on `target_thread_id` (Drift's 1:1) with that wake payload; remembered in `harnessTurnRegistry`. **No nested startTurn** on caller — only TARGET gets a turn.
- **Fuse / Halt still on:** in-memory fuse state tracks 40/hour and 8 consecutive a2a per origin thread; `appendMailboxFuseTripNotice` on trip; `isMailboxFrozen` 423 frozen; `checkMailboxFuse` 429 fuse_tripped. Human `thawMailboxRoom` resets consecutive (so Jack speaking clears the streak).
- **Nonce dedupe:** `MailboxNonceStore` key `thread_id::nonce` (externalMessageId) makes replay idempotent — no second bubble, no second wake.

## Files
- `portal/packages/bff/src/mailbox-send.ts` — fuse + nonce + hop + harness enqueue (tools path, lac-r9w)
- `portal/packages/bff/src/app.ts` — `POST /internal/mailbox/send` + per-app `mailboxNonceStore`/`mailboxFuseState` + human thaw resets consecutive + `harnessServiceToken` in `BffBindings`
- `portal/packages/bff/src/types.ts` — allow `harnessServiceToken` in bindings
- `portal/packages/bff/test/test-helpers.ts` — default harness token for tests
- `portal/packages/bff/test/mailbox-send.test.ts` — 4 vitest proofs (origin notice, target harness turn, dedupe, fuse, 401)
- `portal/apps/web/ui-testing/test_lp_k5c4_18_mailbox_runner.py` — Playwright both-rooms artifact (401 gate + shots + REPORT)
- `artifacts/ui/lp-k5c4.18/REPORT.json` — this run's checks

## Verification
- `pnpm -C portal --filter @lanyard/bff exec vitest run mailbox-send` — **4 passed**
- `vitest run mailbox-hop|mailbox-halt|mailbox-fuse|mailbox-nonce` — **41 passed**
- `vitest run chat-harness` — **5 passed** (no regression)
- Playwright: offline contract is the source of truth; live gate is 401 without token, screenshots are placeholders until `BASE_URL` + `BFF_URL` harness stack is up. Re-run: `BASE_URL=http://127.0.0.1:3153 BFF_URL=http://127.0.0.1:4153 pytest portal/apps/web/ui-testing/test_lp_k5c4_18_mailbox_runner.py -v`

## Drift proof (how to check live)
1. Open Cipher 1:1, have Cipher (tool runner) call `mailbox.send({to: Drift, room: CipherThread, text: "we are slipping", nonce: uuid})` via the harness tool.
2. Cipher history shows `system_notice: A message has been sent to Drift.` (icon chrome).
3. Drift 1:1 history (via `GET /api/chat/threads/:id/history`) or UI shows the inbound hidden_instruction wake; Drift's harness turn streams `echo: we are slipping` or real reply. Drift can reply without Jack opening Drift's composer.

