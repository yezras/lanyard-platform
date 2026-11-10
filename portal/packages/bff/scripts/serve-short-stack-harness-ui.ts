/**
 * DEPRECATED stub (lp-57ha — fakes removed).
 *
 * Formerly in-process in-process test harness + in-memory S3 for short-stack UI QA.
 * Now use portal/test/harness-local.ts against the real lanyard-agent binary
 * on 127.0.0.1 + local Postgres + BFF 4000 + real LLM key.
 *
 * This script is retained as a stub so `tsx` does not fail when invoked via
 * old docs. It exits with guidance.
 */
console.error(
  "serve-short-stack harness stub: use portal/test/harness-local.ts with real harness at HARNESS_URL (default http://127.0.0.1:4310) + BFF 4000 + local Postgres. See docs/plans/0019-inbound-work-spine/overview.md",
);
process.exit(1);
