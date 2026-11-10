/**
 * lp-vqr0.7 — create-ahead is a closed decision, not an if/else in wake.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  decideCreateAhead,
  type CreateAheadInput,
} from "../src/sandbox-create-ahead.js";

const here = dirname(fileURLToPath(import.meta.url));

function input(
  overrides: Partial<CreateAheadInput> & Pick<CreateAheadInput, "runtime_kind">,
): CreateAheadInput {
  return {
    sandbox_id: null,
    ...overrides,
  };
}

describe("decideCreateAhead (lp-vqr0.7)", () => {
  it("unbound daytona creates then retains", () => {
    expect(decideCreateAhead(input({ runtime_kind: "daytona" }))).toEqual({
      action: "create_start_stop_retain",
    });
  });

  it("already bound is a no-op (does not create)", () => {
    expect(
      decideCreateAhead(
        input({ runtime_kind: "daytona", sandbox_id: "sb-1" }),
      ),
    ).toEqual({
      action: "noop",
      reason: "already_bound",
      sandbox_id: "sb-1",
    });
  });

  it("blank sandbox_id is treated as unbound", () => {
    expect(
      decideCreateAhead(input({ runtime_kind: "daytona", sandbox_id: "  " })),
    ).toEqual({ action: "create_start_stop_retain" });
  });

  it("ec2 always-on never creates", () => {
    expect(
      decideCreateAhead(
        input({ runtime_kind: "ec2", sandbox_id: null }),
      ),
    ).toEqual({ action: "noop", reason: "ec2_always_on" });
  });

  it("exports decideCreateAhead from the package index", () => {
    const indexSrc = readFileSync(join(here, "../src/index.ts"), "utf8");
    expect(indexSrc).toContain("decideCreateAhead");
    expect(indexSrc).toContain("./sandbox-create-ahead.js");
  });
});
