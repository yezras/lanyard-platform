import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * G1.3 / G1.4 partial (LOCAL): product topology fail-closed checks.
 * Ensures compose / smoke do not publish control-plane on all interfaces,
 * and that the production topology ADR exists with private-only doctrine.
 *
 * This is **not** live staging evidence. Staging-only steps: docs/staging-proofs.md
 * and scripts/staging-g1-cp-boundary-proof.sh.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function readRepo(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("private control-plane topology (G1.3 local properties)", () => {
  it("ships a production topology ADR with private-only CP doctrine", () => {
    const adr = readRepo("artifacts/portal-production-topology.md");
    expect(adr).toMatch(/never.*public ALB/i);
    expect(adr).toMatch(/private/i);
    expect(adr).toMatch(/CONTROL_PLANE_SERVICE_TOKEN/);
    expect(adr).toMatch(/fail-closed/i);
  });

  it("binds compose control-plane publish to loopback only (not 0.0.0.0)", () => {
    const compose = readRepo("docker-compose.yml");

    expect(compose).toMatch(/control-plane:/);

    const cpBlockMatch = compose.match(
      /control-plane:[\s\S]*?(?=\nvolumes:|\n[a-z].*:|$)/,
    );
    expect(cpBlockMatch).toBeTruthy();
    const cpBlock = cpBlockMatch![0];

    // Forbidden: bare "3100:3100" or "0.0.0.0:3100:3100" without loopback
    expect(cpBlock).not.toMatch(/ports:\s*\n\s*-\s*["']?3100:3100["']?/);
    expect(cpBlock).not.toMatch(/0\.0\.0\.0:3100/);

    // Required: loopback host bind
    expect(cpBlock).toMatch(/127\.0\.0\.1:3100:3100/);
  });

  it("docker-smoke publishes CP on 127.0.0.1 only", () => {
    const smoke = readRepo("scripts/docker-smoke.sh");
    expect(smoke).toMatch(/-p\s+"127\.0\.0\.1:\$\{CP_HOST_PORT\}:3100"/);
    expect(smoke).not.toMatch(/-p\s+"\$\{CP_HOST_PORT\}:3100"/);
    expect(smoke).not.toMatch(/-p\s+"0\.0\.0\.0:\$\{CP_HOST_PORT\}:3100"/);
  });

  it("documents no public CP listener and BFF as public API edge", () => {
    const adr = readRepo("artifacts/portal-production-topology.md");
    expect(adr).toMatch(/BFF is the public API edge/i);
    expect(adr).toMatch(/Forbidden/i);
    expect(adr).toMatch(/public ALB/i);
  });

  it("ships staging proof harness scripts (fail-closed design)", () => {
    const g1 = readRepo("scripts/staging-g1-cp-boundary-proof.sh");
    const g3 = readRepo("scripts/staging-g3-brain-rpc-proof.sh");
    const local = readRepo("scripts/local-topology-proof.sh");
    for (const body of [g1, g3, local]) {
      expect(body).toMatch(/FAIL CLOSED|fail.closed|fail_closed/i);
      expect(body).toMatch(/STAGING_|local topology|LOCAL/i);
    }
    expect(g1).toMatch(/STAGING_BASE_URL|STAGING_BFF_URL/);
    expect(g3).toMatch(/STAGING_BASE_URL|STAGING_BFF_URL/);
  });
});
