import { describe, expect, it } from "vitest";

import {
  CHAT_VS_HOST_COPY,
  chatVsHostCopy,
  directoryEmptyHintCopy,
  directoryUnavailableHintCopy,
  modelConnectivityHonesty,
  parseChatDelivery,
  parseVaultPlane,
  resolveHonestyNotice,
  vaultEmptyStateCopy,
} from "./honestyCopy.js";

describe("resolveHonestyNotice", () => {
  describe("settings", () => {
    it("shows fixture honesty when source=fixture (even if brain_rpc on)", () => {
      const notice = resolveHonestyNotice({
        surface: "settings",
        brainRpcEnabled: true,
        settingsSource: "fixture",
      });
      expect(notice).not.toBeNull();
      expect(notice?.id).toBe("settings-fixture");
      expect(notice?.title).toMatch(/fixture/i);
      expect(notice?.description).toContain(CHAT_VS_HOST_COPY);
      expect(notice?.description).toMatch(/Disconnected/i);
      // No secrets
      expect(notice?.description).not.toMatch(/api[_-]?key|secret|token|password/i);
    });

    it("shows brain_rpc-off honesty when source is hermes and flag is false", () => {
      const notice = resolveHonestyNotice({
        surface: "settings",
        brainRpcEnabled: false,
        settingsSource: "hermes",
      });
      expect(notice?.id).toBe("settings-brain-rpc-off");
      expect(notice?.title).toMatch(/not the agent's live settings/i);
      expect(notice?.description).toMatch(/not loading the agent's settings/i);
      expect(notice?.description).not.toMatch(/brain/i);
      expect(notice?.description).toContain(CHAT_VS_HOST_COPY);
    });

    it("prefers fixture over brain_rpc-off when both apply", () => {
      const notice = resolveHonestyNotice({
        surface: "settings",
        brainRpcEnabled: false,
        settingsSource: "fixture",
      });
      expect(notice?.id).toBe("settings-fixture");
    });

    it("returns null for live hermes + brain_rpc on", () => {
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: true,
          settingsSource: "hermes",
        }),
      ).toBeNull();
    });

    it("returns null for brain_rpc/backend sources when brain_rpc is on", () => {
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: true,
          settingsSource: "brain_rpc",
        }),
      ).toBeNull();
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: true,
          settingsSource: "backend",
        }),
      ).toBeNull();
    });

    it("returns null for lanyard_agent host source (lp-p2a — never fixture)", () => {
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: true,
          settingsSource: "lanyard_agent",
        }),
      ).toBeNull();
    });

    it("shows brain_rpc-off honesty for backend/brain_rpc sources when flag is false", () => {
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: false,
          settingsSource: "brain_rpc",
        })?.id,
      ).toBe("settings-brain-rpc-off");
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: false,
          settingsSource: "backend",
        })?.id,
      ).toBe("settings-brain-rpc-off");
    });

    it("returns null while brain_rpc unknown and source not fixture", () => {
      expect(
        resolveHonestyNotice({
          surface: "settings",
          brainRpcEnabled: null,
          settingsSource: "hermes",
        }),
      ).toBeNull();
    });
  });

  describe("vault", () => {
    it("shows honesty when brain_rpc is off", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: false,
        vaultEmpty: true,
      });
      expect(notice?.id).toBe("vault-brain-rpc-off");
      expect(notice?.title).toBe("Agent files");
      expect(notice?.description).toMatch(/the vault is the agent's files/i);
      expect(`${notice?.title} ${notice?.description}`).not.toMatch(
        /brain|fixture|host protocol/i,
      );
    });

    it("hides banner when brain_rpc on and tree has roots", () => {
      expect(
        resolveHonestyNotice({
          surface: "vault",
          brainRpcEnabled: true,
          vaultEmpty: false,
        }),
      ).toBeNull();
    });

    it("suppresses truncated honesty when lazy entries work (lp-vnz.10)", () => {
      // Condition that used to yellow-banner (lp-8ty): tree.truncated=true.
      // After on-demand /api/vault/entries (lp-ypx), this is navigable — no banner.
      expect(
        resolveHonestyNotice({
          surface: "vault",
          brainRpcEnabled: true,
          vaultEmpty: false,
          vaultTruncated: true,
        }),
      ).toBeNull();
      expect(
        resolveHonestyNotice({
          surface: "vault",
          brainRpcEnabled: true,
          vaultEmpty: false,
          vaultTruncated: true,
          vaultLazyEntriesAvailable: true,
        }),
      ).toBeNull();
    });

    it("shows truncated honesty only when lazy entries are unavailable", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: true,
        vaultEmpty: false,
        vaultTruncated: true,
        vaultLazyEntriesAvailable: false,
      });
      expect(notice?.id).toBe("vault-tree-truncated");
      expect(notice?.status).toBe("warning");
      expect(notice?.description).toMatch(/initial vault tree hit a size limit/i);
    });

    it("prefers empty-host over suppressed truncated when lazy works", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: true,
        vaultEmpty: true,
        vaultTruncated: true,
      });
      expect(notice?.id).toBe("vault-empty-host");
    });

    it("prefers truncated notice over empty when lazy is unavailable", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: true,
        vaultEmpty: true,
        vaultTruncated: true,
        vaultLazyEntriesAvailable: false,
      });
      expect(notice?.id).toBe("vault-tree-truncated");
    });

    it("shows empty-host notice when brain_rpc on and tree empty", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: true,
        vaultEmpty: true,
      });
      expect(notice?.id).toBe("vault-empty-host");
      expect(notice?.description).toMatch(/agent's files/i);
      expect(notice?.description).toMatch(/none are listed/i);
    });

    it("shows unavailable honesty when the tree failed (not silent empty)", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: true,
        vaultEmpty: true,
        vaultUnavailable: true,
      });
      expect(notice?.id).toBe("vault-unavailable");
      expect(notice?.status).toBe("warning");
      expect(notice?.description).toMatch(/agent's files could not be loaded/i);
      expect(notice?.description).not.toMatch(/brain|fixture|host protocol/i);
    });

    it("returns null while brain_rpc unknown", () => {
      expect(
        resolveHonestyNotice({
          surface: "vault",
          brainRpcEnabled: null,
          vaultEmpty: true,
        }),
      ).toBeNull();
    });
  });

  describe("directory", () => {
    it("shows honesty when brain_rpc is off and directory empty", () => {
      const notice = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: false,
        directoryEmpty: true,
      });
      expect(notice?.id).toBe("directory-brain-rpc-off");
      expect(notice?.description).toMatch(/not a chat failure/i);
      expect(notice?.description).toContain(CHAT_VS_HOST_COPY);
    });

    it("shows honesty when brain_rpc is off even with projects", () => {
      const notice = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: false,
        directoryEmpty: false,
      });
      expect(notice?.id).toBe("directory-brain-rpc-off");
      expect(notice?.description).toMatch(/from this session/i);
      expect(notice?.description).not.toMatch(/brain/i);
    });

    it("shows empty notice when brain_rpc on and no projects", () => {
      const notice = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: true,
        directoryEmpty: true,
      });
      expect(notice?.id).toBe("directory-empty-host");
    });

    it("shows unavailable honesty when projects.list fails (not silent empty)", () => {
      const notice = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: true,
        directoryEmpty: true,
        directoryUnavailable: true,
      });
      expect(notice?.id).toBe("directory-unavailable");
      expect(notice?.title).toMatch(/unavailable/i);
      expect(notice?.description).toMatch(/not a live project list/i);
      expect(notice?.description).toContain(CHAT_VS_HOST_COPY);
      expect(notice?.description).not.toMatch(/brain/i);
    });

    it("prefers unavailable over brain_rpc-off when list failed", () => {
      const notice = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: false,
        directoryUnavailable: true,
      });
      expect(notice?.id).toBe("directory-unavailable");
    });

    it("returns null when brain_rpc on and projects present", () => {
      expect(
        resolveHonestyNotice({
          surface: "directory",
          brainRpcEnabled: true,
          directoryEmpty: false,
        }),
      ).toBeNull();
    });
  });

  describe("short stack VaultPlane=cp_s3 / ChatDelivery=harness (lp-oop.37.8)", () => {
    const shortStack = {
      vaultPlane: "cp_s3" as const,
      chatDelivery: "harness" as const,
    };

    it("chatVsHostCopy does not claim Relay or Brain RPC for Directory/Vault", () => {
      const copy = chatVsHostCopy(shortStack);
      expect(copy).not.toBe(CHAT_VS_HOST_COPY);
      expect(copy).not.toMatch(/relay path/i);
      expect(copy).not.toMatch(/brain/i);
      expect(copy).toMatch(/harness path/i);
      expect(copy).toMatch(/agent's files/i);
    });

    it("directory unavailable stays honest without guest-world Relay/Brain RPC copy", () => {
      const notice = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: false,
        directoryEmpty: true,
        directoryUnavailable: true,
        ...shortStack,
      });
      expect(notice?.id).toBe("directory-unavailable");
      expect(notice?.status).toBe("warning");
      expect(notice?.description).toMatch(/not a live project list/i);
      expect(notice?.description).toContain(chatVsHostCopy(shortStack));
      expect(notice?.description).not.toContain(CHAT_VS_HOST_COPY);
      expect(notice?.description).not.toMatch(/relay path/i);
      expect(notice?.description).not.toMatch(/brain/i);
    });

    it("does not call Directory a Brain RPC / fixture surface when plane is cp_s3", () => {
      expect(
        resolveHonestyNotice({
          surface: "directory",
          brainRpcEnabled: false,
          directoryEmpty: false,
          ...shortStack,
        }),
      ).toBeNull();
      const empty = resolveHonestyNotice({
        surface: "directory",
        brainRpcEnabled: false,
        directoryEmpty: true,
        ...shortStack,
      });
      expect(empty?.id).toBe("directory-empty-host");
      expect(empty?.description).toMatch(/control-plane Directory/i);
      expect(empty?.description).not.toMatch(/brain/i);
      expect(empty?.description).not.toMatch(/relay/i);
    });

    it("does not call Vault local/fixture when plane is cp_s3", () => {
      expect(
        resolveHonestyNotice({
          surface: "vault",
          brainRpcEnabled: false,
          vaultEmpty: false,
          ...shortStack,
        }),
      ).toBeNull();
      const empty = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: false,
        vaultEmpty: true,
        ...shortStack,
      });
      expect(empty?.id).toBe("vault-empty-host");
      expect(empty?.description).toMatch(/agent's files/i);
      expect(empty?.description).not.toMatch(/fixture|brain|relay|host protocol/i);
    });

    it("vault unavailable stays honest without guest-world Relay/Brain RPC copy", () => {
      const notice = resolveHonestyNotice({
        surface: "vault",
        brainRpcEnabled: true,
        vaultEmpty: true,
        vaultUnavailable: true,
        ...shortStack,
      });
      expect(notice?.id).toBe("vault-unavailable");
      expect(notice?.status).toBe("warning");
      expect(notice?.description).toMatch(/agent's files could not be loaded/i);
      expect(notice?.description).not.toContain(CHAT_VS_HOST_COPY);
      expect(notice?.description).not.toMatch(/relay path/i);
      expect(notice?.description).not.toMatch(/brain|fixture|host protocol/i);
    });

    it("settings fixture/off still warn, but not that Directory/Vault need Brain RPC", () => {
      const fixture = resolveHonestyNotice({
        surface: "settings",
        brainRpcEnabled: true,
        settingsSource: "fixture",
        ...shortStack,
      });
      expect(fixture?.id).toBe("settings-fixture");
      expect(fixture?.description).toContain(chatVsHostCopy(shortStack));
      expect(fixture?.description).not.toContain(CHAT_VS_HOST_COPY);
      expect(fixture?.description).not.toMatch(/need host Brain RPC/i);

      const off = resolveHonestyNotice({
        surface: "settings",
        brainRpcEnabled: false,
        settingsSource: "hermes",
        ...shortStack,
      });
      expect(off?.id).toBe("settings-brain-rpc-off");
      expect(off?.description).toMatch(/not loading the agent's settings/i);
      expect(off?.title).not.toMatch(/brain/i);
      expect(off?.description).not.toMatch(/brain/i);
      expect(off?.description).not.toMatch(/relay path/i);
    });

    it("supporting hints stay honest on the short stack", () => {
      expect(directoryEmptyHintCopy(shortStack)).not.toMatch(/relay|brain/i);
      expect(directoryUnavailableHintCopy(shortStack)).toMatch(/harness path/i);
      expect(directoryUnavailableHintCopy(shortStack)).not.toMatch(/relay/i);
      expect(
        vaultEmptyStateCopy({ brainRpcEnabled: false, ...shortStack }),
      ).toBe("No files");
    });
  });
});

describe("chatVsHostCopy + plane parsers", () => {
  it("defaults to guest-world CHAT_VS_HOST_COPY", () => {
    expect(chatVsHostCopy()).toBe(CHAT_VS_HOST_COPY);
    expect(chatVsHostCopy({ chatDelivery: "relay" })).toBe(CHAT_VS_HOST_COPY);
    expect(chatVsHostCopy({ vaultPlane: "fs" })).toBe(CHAT_VS_HOST_COPY);
    expect(chatVsHostCopy({ vaultPlane: "brain_rpc" })).toBe(CHAT_VS_HOST_COPY);
  });

  it("parses known plane tags and rejects unknowns", () => {
    expect(parseChatDelivery("harness")).toBe("harness");
    expect(parseChatDelivery("relay")).toBe("relay");
    expect(parseChatDelivery("grpc")).toBeNull();
    expect(parseVaultPlane("cp_s3")).toBe("cp_s3");
    expect(parseVaultPlane("brain_rpc")).toBe("brain_rpc");
    expect(parseVaultPlane("fs")).toBe("fs");
    expect(parseVaultPlane("s3")).toBeNull();
  });
});

describe("signed-in honesty copy", () => {
  it("never shows Brain, Brain RPC, or a host protocol name", () => {
    const surfaces = ["settings", "vault", "directory"] as const;
    const planes = [null, "fs", "brain_rpc", "cp_s3"] as const;
    const deliveries = [null, "relay", "harness"] as const;
    const flags = [null, true, false] as const;
    const sources = [null, "fixture", "hermes", "brain_rpc", "backend"] as const;
    const texts: string[] = [
      CHAT_VS_HOST_COPY,
      chatVsHostCopy(),
      chatVsHostCopy({ chatDelivery: "harness" }),
      chatVsHostCopy({ vaultPlane: "cp_s3", chatDelivery: "harness" }),
      chatVsHostCopy({ vaultPlane: "cp_s3", chatDelivery: "relay" }),
      directoryEmptyHintCopy({}),
      directoryEmptyHintCopy({ vaultPlane: "cp_s3", chatDelivery: "harness" }),
      directoryUnavailableHintCopy({}),
      directoryUnavailableHintCopy({ chatDelivery: "harness" }),
      vaultEmptyStateCopy({ brainRpcEnabled: false }) ?? "",
      vaultEmptyStateCopy({
        brainRpcEnabled: false,
        vaultPlane: "cp_s3",
        chatDelivery: "harness",
      }) ?? "",
    ];

    for (const surface of surfaces) {
      for (const vaultPlane of planes) {
        for (const chatDelivery of deliveries) {
          for (const brainRpcEnabled of flags) {
            for (const settingsSource of sources) {
              const notice = resolveHonestyNotice({
                surface,
                brainRpcEnabled,
                vaultPlane,
                chatDelivery,
                settingsSource,
                directoryEmpty: true,
                vaultEmpty: true,
                vaultUnavailable: surface === "vault" && brainRpcEnabled === true,
                directoryUnavailable:
                  surface === "directory" && brainRpcEnabled === true,
              });
              if (!notice) continue;
              texts.push(notice.title, notice.description);
            }
          }
        }
      }
    }

    for (const text of texts) {
      expect(text).not.toMatch(/brain/i);
      expect(text).not.toMatch(/host protocol/i);
    }
  });
});

describe("modelConnectivityHonesty", () => {
  it("relabels disconnected models under fixture source", () => {
    const offline = modelConnectivityHonesty({
      connected: false,
      settingsSource: "fixture",
    });
    expect(offline.label).toBe("Fixture: offline");
    expect(offline.tooltip).toMatch(/not a live host gateway/i);
    expect(offline.label).not.toBe("Disconnected");
  });

  it("keeps Connected / Disconnected for non-fixture", () => {
    expect(
      modelConnectivityHonesty({ connected: true, settingsSource: "hermes" })
        .label,
    ).toBe("Connected");
    expect(
      modelConnectivityHonesty({ connected: false, settingsSource: "hermes" })
        .label,
    ).toBe("Disconnected");
  });
});
