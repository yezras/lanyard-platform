/**
 * Write lp-hdzm.31 evidence JSON. Never prints the Class C token.
 *
 * CONTROL_PLANE_DATABASE_URL / DATABASE_URL required.
 * Optional STRIPE_RESTRICTED_KEY hits live Stripe GET /v1/customers.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLASS_C_AUTHORIZATION_HEADER,
  type ClassCFetch,
} from "../src/class-c-attach.js";
import {
  proveMockLabStripeResidual,
  stripeResidualPassed,
  type MockLabStripeResidualEvidence,
} from "../src/mocklab-stripe-residual.js";
import { createTestStore } from "../test/pg-test-store.js";

const BEAD = "lp-hdzm.31";
const TOKEN_STUB = "sk_test_lp_hdzm31_prove_stub";

type LiveAdminProbe = {
  probed: boolean;
  admin_http: number | null;
  me_http: number | null;
  tenants_http: number | null;
  operator_emails_residual: boolean;
  note: string;
};

function liveKey(): string | null {
  const value = process.env.STRIPE_RESTRICTED_KEY?.trim();
  if (!value || value.startsWith("sk_test_lp_hdzm31")) {
    return null;
  }
  return value;
}

function liveStripeFetch(): ClassCFetch {
  return async (req) => {
    const response = await fetch(req.url, {
      method: req.method ?? "GET",
      headers: req.headers,
      body: req.body,
    });
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  };
}

async function probeLiveAdmin(): Promise<LiveAdminProbe> {
  const residual =
    "PLATFORM_OPERATOR_EMAILS / lp-2qs.6 may still block live /admin sign-in. needs_ui_qa.";
  const base = (
    process.env.LP_HDZM31_ADMIN_BASE ?? "https://app.withlanyard.com"
  ).replace(/\/$/, "");
  const probe = process.env.LP_HDZM31_PROBE_LIVE !== "0";
  if (!probe) {
    return {
      probed: false,
      admin_http: null,
      me_http: null,
      tenants_http: null,
      operator_emails_residual: true,
      note: residual,
    };
  }
  try {
    const [admin, me, tenants] = await Promise.all([
      fetch(`${base}/admin`, { redirect: "manual" }),
      fetch(`${base}/api/admin/auth/me`, { redirect: "manual" }),
      fetch(`${base}/api/admin/tenants`, { redirect: "manual" }),
    ]);
    const meHttp = me.status;
    return {
      probed: true,
      admin_http: admin.status,
      me_http: meHttp,
      tenants_http: tenants.status,
      operator_emails_residual: meHttp === 401 || meHttp === 403,
      note: residual,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      probed: true,
      admin_http: null,
      me_http: null,
      tenants_http: null,
      operator_emails_residual: true,
      note: `${residual} Probe error: ${message}`,
    };
  }
}

function resultMarkdown(input: {
  evidence: MockLabStripeResidualEvidence;
  live: LiveAdminProbe;
  passed: boolean;
}): string {
  const { evidence, live, passed } = input;
  const checks = Object.entries(evidence.checks)
    .map(([key, ok]) => `- [${ok ? "x" : " "}] ${key}`)
    .join("\n");
  return `# lp-hdzm.31 Mock Lab Stripe residual

**Bead:** \`${BEAD}\`
**Verdict:** **${passed ? "PASS" : "FAIL"}**
**Fetch:** \`${evidence.fetch_mode}\`
**Authorization logged:** \`${evidence.authorization_logged}\`

## 6-tuple

- domain: \`${evidence.tuple.domain}\`
- surface: \`${evidence.tuple.surface}\` (\`${evidence.tuple.surface_id}\`)
- principal: \`${evidence.tuple.principal}\`
- auth: \`${evidence.tuple.auth_kind}\`
- tool: \`${evidence.tuple.tool}\` (\`${evidence.tuple.group}\`)
- paste: \`${evidence.tuple.paste}\`

## Checks

${checks}

- CP fingerprint present: \`${evidence.cp_fingerprint !== null}\`
- tool HTTP: \`${evidence.http_status}\`
- re-wake HTTP: \`${evidence.rewake_http_status}\`
- member omit: \`${evidence.member_omit_status}\`
- guest files wake: \`${evidence.guest_files_wake.join(",") || "(none)"}\`
- guest files re-wake: \`${evidence.guest_files_rewake.join(",") || "(none)"}\`
- token leaked: \`${evidence.token_leaked}\`

## Live /admin

- probed: \`${live.probed}\`
- \`/admin\`: \`${live.admin_http}\`
- \`/api/admin/auth/me\`: \`${live.me_http}\`
- \`/api/admin/tenants\`: \`${live.tenants_http}\`
- operator email residual: \`${live.operator_emails_residual}\`

${live.note}

Live paste through \`/admin\` is \`needs_ui_qa\` until lp-2qs.6 sets \`PLATFORM_OPERATOR_EMAILS\`.
`;
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "../../../../");
  const outDir = path.join(repoRoot, "artifacts/mocklab/lp-hdzm.31");
  const key = liveKey();
  const store = await createTestStore();
  try {
    const evidence = await proveMockLabStripeResidual({
      store,
      token: key ?? TOKEN_STUB,
      fetch: key
        ? liveStripeFetch()
        : undefined,
      fetchMode: key ? "live" : "stub",
    });
    const live = await probeLiveAdmin();
    const passed = stripeResidualPassed(evidence);
    const report = {
      bead_id: BEAD,
      passed,
      evidence,
      live,
      authorization_header: CLASS_C_AUTHORIZATION_HEADER,
    };
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, "REPORT.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      path.join(outDir, "RESULT.md"),
      resultMarkdown({ evidence, live, passed }),
      "utf8",
    );
    if (!passed) {
      process.exitCode = 1;
    }
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
