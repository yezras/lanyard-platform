#!/usr/bin/env node
/**
 * Training export CLI (lp-gkh.8).
 *
 * List / stream ChatTurnRecord objects under tenants/{tid}/chat-corpus by
 * UTC date range. Ops / training-pipeline roles only — no tenant browser API.
 *
 * Dry-run (no AWS, no secrets):
 *   pnpm --filter @lanyard/chat-corpus export:training -- --fake \
 *     --tenant tenant-1 --from 2026-08-06 --to 2026-08-08
 *
 * Programmatic live path: inject a CorpusObjectStore with listObjects+getObject
 * backed by the corpus reader IAM role (see drafts/iam/corpus-reader-policy.json).
 * This CLI's --fake mode is the offline acceptance path; host adapters wire AWS.
 */

import {
  contentSha256,
  CorpusTrainingExporter,
  FakeCorpusObjectStore,
  S3CorpusWriter,
  type ChatTurnRecord,
} from "../index.js";

type Mode = "list" | "jsonl";

type CliArgs = {
  fake: boolean;
  tenant: string;
  from: string;
  to: string;
  bucket: string;
  mode: Mode;
  help: boolean;
  /** When --fake, seed demo turns (default true for dry-run demos). */
  seed: boolean;
};

const DEFAULT_FAKE_BUCKET = "lanyard-chat-corpus-fake";
const DEFAULT_TENANT = "tenant-1";

function printHelp(): void {
  const text = `
@lanyard/chat-corpus training export (lp-gkh.8)

List / read ChatTurnRecord objects by tenant + inclusive UTC date range.
Auth: ops / training-pipeline reader role only. No tenant browser API in v1.

Usage:
  pnpm --filter @lanyard/chat-corpus export:training -- [options]

Options:
  --fake              Use in-memory fake S3 (no credentials; dry-run)
  --tenant <id>       Tenant id (default: tenant-1 in --fake mode)
  --from <date>       Inclusive range start (YYYY-MM-DD or RFC3339)
  --to <date>         Inclusive range end (YYYY-MM-DD or RFC3339)
  --bucket <name>     Bare bucket name (required without --fake)
  --mode list|jsonl   list = keys only (default); jsonl = stream records
  --no-seed           With --fake, do not seed demo turns
  -h, --help          Show this help

Dry-run example (no secrets):
  pnpm --filter @lanyard/chat-corpus export:training -- --fake \\
    --tenant tenant-1 --from 2026-08-06 --to 2026-08-08 --mode list

JSONL stream (fake):
  pnpm --filter @lanyard/chat-corpus export:training -- --fake \\
    --tenant tenant-1 --from 2026-08-06 --to 2026-08-08 --mode jsonl

Live export:
  Wire a CorpusObjectStore (listObjects + getObject) with the corpus reader
  IAM role via AWS default credential chain / instance profile. Do not put
  access keys in this README or in argv. Prefer programmatic CorpusTrainingExporter
  from an approved ops job rather than long-lived keys on a laptop.

Object layout:
  tenants/{tenant_id}/chat-corpus/v1/year=YYYY/month=MM/day=DD/thread={id}/turn={id}.json
`.trim();
  process.stdout.write(`${text}\n`);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    fake: false,
    tenant: "",
    from: "",
    to: "",
    bucket: "",
    mode: "list",
    help: false,
    seed: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    // pnpm / npm often forward a bare `--` separator into scripts.
    if (a === "--") {
      continue;
    }
    if (a === "-h" || a === "--help") {
      out.help = true;
      continue;
    }
    if (a === "--fake") {
      out.fake = true;
      continue;
    }
    if (a === "--no-seed") {
      out.seed = false;
      continue;
    }
    if (a === "--tenant") {
      out.tenant = argv[++i] ?? "";
      continue;
    }
    if (a === "--from") {
      out.from = argv[++i] ?? "";
      continue;
    }
    if (a === "--to") {
      out.to = argv[++i] ?? "";
      continue;
    }
    if (a === "--bucket") {
      out.bucket = argv[++i] ?? "";
      continue;
    }
    if (a === "--mode") {
      const m = (argv[++i] ?? "").toLowerCase();
      if (m !== "list" && m !== "jsonl") {
        throw new Error(`--mode must be list or jsonl (got ${m || "(empty)"})`);
      }
      out.mode = m;
      continue;
    }
    throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function demoRecord(
  overrides: Partial<ChatTurnRecord> &
    Pick<ChatTurnRecord, "tenant_id" | "thread_id" | "turn_id" | "created_at">,
): ChatTurnRecord {
  const inputContent = `user message for ${overrides.turn_id}`;
  const outputContent = `assistant reply for ${overrides.turn_id}`;
  return {
    schema_version: 1,
    record_type: "chat_turn",
    tenant_id: overrides.tenant_id,
    user_id: overrides.user_id ?? "user-demo",
    instance_id: overrides.instance_id ?? "instance-demo",
    thread_id: overrides.thread_id,
    turn_id: overrides.turn_id,
    created_at: overrides.created_at,
    model: overrides.model ?? { provider: "poolside", name: "laguna-s-2.1" },
    input: {
      role: "user",
      content: inputContent,
      content_sha256: contentSha256(inputContent),
    },
    output: {
      role: "assistant",
      content: outputContent,
      content_sha256: contentSha256(outputContent),
      finish_reason: "stop",
    },
    tool_events: [],
    meta: { client: "portal_web" },
  };
}

/**
 * Seed a few turns across days so dry-run list shows expected hive keys.
 * Includes one out-of-range and one other-tenant object to prove filtering.
 */
async function seedFakeDemo(
  store: FakeCorpusObjectStore,
  bucket: string,
  tenantId: string,
): Promise<string[]> {
  const writer = new S3CorpusWriter({ bucket, store });
  const demos = [
    demoRecord({
      tenant_id: tenantId,
      thread_id: "thread-a",
      turn_id: "turn-a1",
      created_at: "2026-08-06T10:00:00.000Z",
    }),
    demoRecord({
      tenant_id: tenantId,
      thread_id: "thread-a",
      turn_id: "turn-a2",
      created_at: "2026-08-07T12:30:00.000Z",
    }),
    demoRecord({
      tenant_id: tenantId,
      thread_id: "thread-b",
      turn_id: "turn-b1",
      created_at: "2026-08-08T08:15:00.000Z",
    }),
    // Outside default dry-run window (should not appear for 08-06..08-08 if we use that, wait - it is on 08-08)
    // Extra: day before window when callers use 08-07 only; always seed out-of-window:
    demoRecord({
      tenant_id: tenantId,
      thread_id: "thread-old",
      turn_id: "turn-old",
      created_at: "2026-08-01T00:00:00.000Z",
    }),
    // Other tenant (must never leak into listed keys)
    demoRecord({
      tenant_id: "other-tenant",
      thread_id: "thread-x",
      turn_id: "turn-x1",
      created_at: "2026-08-07T00:00:00.000Z",
    }),
  ];
  const keys: string[] = [];
  for (const rec of demos) {
    const result = await writer.writeTurn(rec);
    if (result.ok) {
      keys.push(result.key);
    } else {
      throw new Error(`seed failed: ${result.code} ${result.error}`);
    }
  }
  return keys;
}

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    process.stderr.write(
      `error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    printHelp();
    return 2;
  }

  if (args.help) {
    printHelp();
    return 0;
  }

  if (!args.fake) {
    process.stderr.write(
      [
        "error: live S3 adapter is not bundled in this package (no @aws-sdk).",
        "Use --fake for offline dry-run, or call CorpusTrainingExporter from an",
        "ops job that injects a CorpusObjectStore with the corpus reader role.",
        "See package README (Training export).",
        "",
      ].join("\n"),
    );
    printHelp();
    return 2;
  }

  const tenant = args.tenant || DEFAULT_TENANT;
  const from = args.from || "2026-08-06";
  const to = args.to || "2026-08-08";
  const bucket = args.bucket || DEFAULT_FAKE_BUCKET;

  const store = new FakeCorpusObjectStore();
  if (args.seed) {
    await seedFakeDemo(store, bucket, tenant);
  }

  const exporter = new CorpusTrainingExporter({ bucket, store });
  const listed = await exporter.listTurns({
    tenant_id: tenant,
    from,
    to,
  });

  if (!listed.ok) {
    process.stderr.write(
      `list failed: ${listed.code}: ${listed.error}\n`,
    );
    return 1;
  }

  if (args.mode === "list") {
    // Machine-friendly: one key per line; header on stderr for humans.
    process.stderr.write(
      [
        `# chat-corpus training export (fake dry-run)`,
        `# tenant=${listed.tenant_id} from=${listed.from} to=${listed.to} bucket=${listed.bucket}`,
        `# prefixes=${listed.prefixes.length} keys=${listed.keys.length}`,
        "",
      ].join("\n"),
    );
    for (const item of listed.keys) {
      process.stdout.write(`${item.key}\n`);
    }
    return 0;
  }

  // jsonl
  let okCount = 0;
  let errCount = 0;
  for await (const row of exporter.iterateTurns({
    tenant_id: tenant,
    from,
    to,
  })) {
    if (!row.ok) {
      errCount += 1;
      process.stderr.write(
        `read failed: ${row.code}: ${row.error}${row.key ? ` key=${row.key}` : ""}\n`,
      );
      continue;
    }
    okCount += 1;
    // One JSON object per line (training pipeline friendly). No secrets in fixture.
    process.stdout.write(`${JSON.stringify(row.record)}\n`);
  }
  process.stderr.write(
    `# jsonl done ok=${okCount} errors=${errCount}\n`,
  );
  return errCount > 0 ? 1 : 0;
}

const exitCode = await main(process.argv.slice(2));
process.exit(exitCode);
