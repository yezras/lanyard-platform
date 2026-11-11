# lp-gkh.9 — MockLab chat corpus live proof

**Bead:** `lp-gkh.9` — Live proof: MockLab chat produces corpus objects with full I/O  
**Plan:** [docs/plans/0011-tenant-chat-corpus/overview.md](../../../docs/plans/0011-tenant-chat-corpus/overview.md)

## How to re-run

```bash
bash deploy/scripts/prove-mocklab-chat-corpus.sh
```

## Evidence

| File | Purpose |
|------|---------|
| `live-proof-evidence-latest.json` | Latest PASS evidence (object key + redacted record shape + BFF restart) |
| `live-proof-evidence-<stamp>.json` | Timestamped copy |

## What is proven

1. `chat_corpus_enabled=true` for mocklab tenant (fail-closed default otherwise)
2. Simulated chat turn writes a durable corpus object with **user + assistant** content
3. Object key matches `tenants/{tid}/chat-corpus/v1/…/turn={turn_id}.json`
4. After simulated BFF restart (new store instance, same FS root), object still present with unchanged body

## Lab vs AWS

Lab uses `FsCorpusObjectStore` under `CHAT_CORPUS_FS_ROOT` (same key layout as S3).  
Terraform module for a real corpus bucket: `deploy/modules/chat-corpus-infra/` (`lp-gkh.3`).  
Do not commit `.corpus-store/` (gitignored) — may contain full I/O.

## UIQA

`needs_ui_qa=true` for browser chat on a host with corpus env wired; automated path covers API chat capture + durability.
