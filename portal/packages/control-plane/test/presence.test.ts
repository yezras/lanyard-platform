/**
 * lp-eya — presence state machine unit tests (offline track).
 * Pure transitions; no Postgres / Daytona / AWS.
 */
import { describe, expect, it } from "vitest";

import {
  allowedPresenceTargets,
  applyPresenceReason,
  assertLegalPresenceTransition,
  IllegalPresenceReasonError,
  IllegalPresenceTransitionError,
  INSTANCE_PRESENCE_STATES,
  isInstancePresence,
  isLegalPresenceTransition,
  nextPresenceForReason,
  parseInstancePresence,
  PRESENCE_TRANSITION_EDGES,
  PRESENCE_TRANSITION_REASONS,
  transitionPresence,
  type InstancePresence,
  type PresenceTransitionReason,
} from "../src/presence.js";

const ALL: InstancePresence[] = [...INSTANCE_PRESENCE_STATES];

/** Build the full 4×4 adjacency for exhaustive checks. */
function allPairs(): Array<[InstancePresence, InstancePresence]> {
  const pairs: Array<[InstancePresence, InstancePresence]> = [];
  for (const from of ALL) {
    for (const to of ALL) {
      pairs.push([from, to]);
    }
  }
  return pairs;
}

describe("presence catalog (lp-eya)", () => {
  it("exports offline|waking|online|error in catalog order", () => {
    expect(INSTANCE_PRESENCE_STATES).toEqual([
      "offline",
      "waking",
      "online",
      "error",
    ]);
  });

  it("isInstancePresence accepts catalog and rejects unknown", () => {
    for (const s of ALL) {
      expect(isInstancePresence(s)).toBe(true);
    }
    expect(isInstancePresence("booting")).toBe(false);
    expect(isInstancePresence("")).toBe(false);
    expect(isInstancePresence(null)).toBe(false);
    expect(isInstancePresence(1)).toBe(false);
  });

  it("parseInstancePresence returns catalog values and throws otherwise", () => {
    expect(parseInstancePresence("waking")).toBe("waking");
    expect(() => parseInstancePresence("booting")).toThrow(/Invalid presence/);
  });
});

describe("legal presence transitions", () => {
  it("allows all self-transitions (idempotent)", () => {
    for (const s of ALL) {
      expect(isLegalPresenceTransition(s, s)).toBe(true);
      expect(transitionPresence(s, s)).toBe(s);
    }
  });

  it("allows documented non-self edges", () => {
    const expected: Array<[InstancePresence, InstancePresence]> = [
      ["offline", "waking"],
      ["error", "waking"],
      ["waking", "online"],
      ["waking", "error"],
      ["waking", "offline"],
      ["online", "offline"],
      ["online", "error"],
      ["error", "offline"],
    ];
    expect([...PRESENCE_TRANSITION_EDGES]).toEqual(expected);
    for (const [from, to] of expected) {
      expect(isLegalPresenceTransition(from, to)).toBe(true);
      expect(transitionPresence(from, to)).toBe(to);
      expect(() => assertLegalPresenceTransition(from, to)).not.toThrow();
    }
  });

  it("rejects illegal transitions with IllegalPresenceTransitionError", () => {
    const illegal: Array<[InstancePresence, InstancePresence]> = [
      ["offline", "online"],
      ["offline", "error"],
      ["online", "waking"],
      ["error", "online"],
    ];
    for (const [from, to] of illegal) {
      expect(isLegalPresenceTransition(from, to)).toBe(false);
      expect(() => transitionPresence(from, to)).toThrow(
        IllegalPresenceTransitionError,
      );
      try {
        assertLegalPresenceTransition(from, to);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(IllegalPresenceTransitionError);
        const e = err as IllegalPresenceTransitionError;
        expect(e.from).toBe(from);
        expect(e.to).toBe(to);
        expect(e.message).toContain(`${from} → ${to}`);
      }
    }
  });

  it("exhaustively classifies every from×to pair", () => {
    const legalNonSelf = new Set(
      PRESENCE_TRANSITION_EDGES.map(([f, t]) => `${f}->${t}`),
    );
    for (const [from, to] of allPairs()) {
      const key = `${from}->${to}`;
      const expected = from === to || legalNonSelf.has(key);
      expect(isLegalPresenceTransition(from, to)).toBe(expected);
    }
  });

  it("allowedPresenceTargets lists self + legal edges in catalog order", () => {
    expect(allowedPresenceTargets("offline")).toEqual(["offline", "waking"]);
    expect(allowedPresenceTargets("waking")).toEqual([
      "offline",
      "waking",
      "online",
      "error",
    ]);
    expect(allowedPresenceTargets("online")).toEqual([
      "offline",
      "online",
      "error",
    ]);
    expect(allowedPresenceTargets("error")).toEqual([
      "offline",
      "waking",
      "error",
    ]);
  });
});

describe("presence transition reasons", () => {
  it("exports the stable reason catalog", () => {
    expect(PRESENCE_TRANSITION_REASONS).toEqual([
      "ensure_online",
      "wake_succeeded",
      "wake_failed",
      "wake_abandoned",
      "idle_stop",
      "explicit_stop",
      "runtime_error",
      "clear",
    ]);
  });

  it("ensure_online: offline|error → waking; online/waking stay (singleflight)", () => {
    expect(nextPresenceForReason("offline", "ensure_online")).toBe("waking");
    expect(nextPresenceForReason("error", "ensure_online")).toBe("waking");
    expect(nextPresenceForReason("online", "ensure_online")).toBe("online");
    expect(nextPresenceForReason("waking", "ensure_online")).toBe("waking");
    expect(applyPresenceReason("offline", "ensure_online")).toBe("waking");
    expect(applyPresenceReason("online", "ensure_online")).toBe("online");
  });

  it("wake_succeeded only from waking → online", () => {
    expect(applyPresenceReason("waking", "wake_succeeded")).toBe("online");
    for (const from of ["offline", "online", "error"] as InstancePresence[]) {
      expect(nextPresenceForReason(from, "wake_succeeded")).toBeNull();
      expect(() => applyPresenceReason(from, "wake_succeeded")).toThrow(
        IllegalPresenceReasonError,
      );
    }
  });

  it("wake_failed only from waking → error", () => {
    expect(applyPresenceReason("waking", "wake_failed")).toBe("error");
    expect(nextPresenceForReason("online", "wake_failed")).toBeNull();
  });

  it("wake_abandoned only from waking → offline", () => {
    expect(applyPresenceReason("waking", "wake_abandoned")).toBe("offline");
  });

  it("idle_stop and explicit_stop drive online/waking/error → offline", () => {
    for (const reason of ["idle_stop", "explicit_stop"] as const) {
      expect(applyPresenceReason("online", reason)).toBe("offline");
      expect(applyPresenceReason("waking", reason)).toBe("offline");
      expect(applyPresenceReason("error", reason)).toBe("offline");
      expect(applyPresenceReason("offline", reason)).toBe("offline");
    }
  });

  it("runtime_error only from online → error", () => {
    expect(applyPresenceReason("online", "runtime_error")).toBe("error");
    for (const from of ["offline", "waking", "error"] as InstancePresence[]) {
      expect(nextPresenceForReason(from, "runtime_error")).toBeNull();
      expect(() => applyPresenceReason(from, "runtime_error")).toThrow(
        IllegalPresenceReasonError,
      );
    }
  });

  it("clear moves error|waking → offline; not applicable from online", () => {
    expect(applyPresenceReason("error", "clear")).toBe("offline");
    expect(applyPresenceReason("waking", "clear")).toBe("offline");
    expect(applyPresenceReason("offline", "clear")).toBe("offline");
    expect(nextPresenceForReason("online", "clear")).toBeNull();
    expect(() => applyPresenceReason("online", "clear")).toThrow(
      IllegalPresenceReasonError,
    );
  });

  it("every reason×from resolution is either null or a legal edge", () => {
    for (const reason of PRESENCE_TRANSITION_REASONS) {
      for (const from of ALL) {
        const next = nextPresenceForReason(from, reason as PresenceTransitionReason);
        if (next !== null) {
          expect(isLegalPresenceTransition(from, next)).toBe(true);
        }
      }
    }
  });

  it("IllegalPresenceReasonError carries from + reason", () => {
    try {
      applyPresenceReason("offline", "wake_succeeded");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalPresenceReasonError);
      const e = err as IllegalPresenceReasonError;
      expect(e.from).toBe("offline");
      expect(e.reason).toBe("wake_succeeded");
    }
  });
});

describe("wake lifecycle path (integration of reasons)", () => {
  it("provision offline → ensure_online → wake_succeeded → idle_stop", () => {
    let p: InstancePresence = "offline";
    p = applyPresenceReason(p, "ensure_online");
    expect(p).toBe("waking");
    p = applyPresenceReason(p, "wake_succeeded");
    expect(p).toBe("online");
    // concurrent ensure_online while online is a no-op
    p = applyPresenceReason(p, "ensure_online");
    expect(p).toBe("online");
    p = applyPresenceReason(p, "idle_stop");
    expect(p).toBe("offline");
  });

  it("failed wake can retry: offline → waking → error → waking → online", () => {
    let p: InstancePresence = "offline";
    p = applyPresenceReason(p, "ensure_online");
    p = applyPresenceReason(p, "wake_failed");
    expect(p).toBe("error");
    p = applyPresenceReason(p, "ensure_online");
    expect(p).toBe("waking");
    p = applyPresenceReason(p, "wake_succeeded");
    expect(p).toBe("online");
  });

  it("runtime failure while online can clear or retry", () => {
    let p: InstancePresence = "online";
    p = applyPresenceReason(p, "runtime_error");
    expect(p).toBe("error");
    p = applyPresenceReason(p, "clear");
    expect(p).toBe("offline");
  });
});
