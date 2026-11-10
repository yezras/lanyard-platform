/**
 * lp-vqr0.13 — T1–T9 encoded in the package tests CI already runs.
 *
 *   pnpm --filter @lanyard/control-plane test
 *
 * Fake / file freeze only. No live Daytona.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  hasLiveDaytonaImport,
  SLO_CI_CASES,
  SLO_CI_IDS,
  SLO_CI_PACKAGE_TEST_SCRIPT,
  SLO_CI_SECTION_HEADING,
  SLO_CI_TESTING_MD,
  sloCiCaseList,
} from "../src/slo-ci.js";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readRepo(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

describe("0017 SLO CI encoding (T1–T9)", () => {
  const testing = readRepo(SLO_CI_TESTING_MD);

  it("catalog is exhaustive T1–T9 and locksteps testing.md", () => {
    expect(SLO_CI_IDS).toEqual([
      "T1",
      "T2",
      "T3",
      "T4",
      "T5",
      "T6",
      "T7",
      "T8",
      "T9",
    ]);
    expect(testing).toContain(SLO_CI_SECTION_HEADING);
    expect(testing).toContain("No live Daytona");
    expect(testing).toContain("pnpm --filter @lanyard/control-plane test");
    expect(testing).toContain("pnpm --filter @lanyard/bff test");
    expect(testing).not.toMatch(/\|\s*T10\s*\|[^|]*\|\s*@lanyard\//);

    for (const id of SLO_CI_IDS) {
      const row = SLO_CI_CASES[id];
      expect(testing).toContain(`| ${id} |`);
      if (row.package === "n/a") {
        expect(row.reason.length).toBeGreaterThan(20);
        expect(testing).toContain("n/a:");
        expect(testing).toContain(row.freezeFile);
        expect(testing).toContain(row.reason);
      } else {
        expect(testing).toContain(row.package);
        expect(testing).toContain(row.file);
        expect(testing).toContain(row.namedTest);
      }
    }
  });

  it("each T1–T9 named test exists, or n/a has a freeze file and reason", () => {
    for (const row of sloCiCaseList()) {
      if (row.package === "n/a") {
        const src = readRepo(row.freezeFile);
        for (const needle of row.freezeNeedles) {
          expect(src).toContain(needle);
        }
        expect(hasLiveDaytonaImport(src)).toBe(false);
        continue;
      }
      const src = readRepo(row.file);
      expect(src).toContain(row.namedTest);
      for (const needle of row.alsoContains ?? []) {
        expect(src).toContain(needle);
      }
      expect(hasLiveDaytonaImport(src)).toBe(false);
    }
  });

  it("CI path is the package test scripts already used in PRs", () => {
    const cp = JSON.parse(
      readRepo("portal/packages/control-plane/package.json"),
    ) as { scripts: { test: string } };
    const bff = JSON.parse(readRepo("portal/packages/bff/package.json")) as {
      scripts: { test: string };
    };
    expect(cp.scripts.test).toBe(SLO_CI_PACKAGE_TEST_SCRIPT);
    expect(bff.scripts.test).toBe(SLO_CI_PACKAGE_TEST_SCRIPT);
  });
});
