/**
 * Auth-free FakeOps story for Playwright flows 1–8 (lp-hdzm.30).
 *
 * Mounted with `?story=fakeops-admin` (superadmin), `fakeops-admin-tenant`,
 * or `fakeops-admin-unauth`. The story installs an in-browser `/api/admin/*`
 * fetch mock, then drives the real ops shell.
 */

import type { CSSProperties } from "react";
import { useMemo } from "react";

import { AuthenticatedOpsConsole } from "../../layout/AuthenticatedOpsConsole.js";
import { createFakeOpsStore, type FakeOpsMode } from "./fakeOps.js";
import { installFakeOpsFetch } from "./fakeOpsFetch.js";

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  minHeight: 0,
};

export type FakeOpsProofStoryProps = {
  mode?: FakeOpsMode;
};

export function FakeOpsProofStory({
  mode = "superadmin",
}: FakeOpsProofStoryProps) {
  const store = useMemo(() => createFakeOpsStore(mode), [mode]);
  installFakeOpsFetch(store);

  return (
    <div
      data-testid="fakeops-proof-story"
      data-fakeops-mode={mode}
      style={rootStyle}
    >
      <AuthenticatedOpsConsole />
    </div>
  );
}
