import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  listAgentCrons,
  listAgentMemory,
  loadAgentBackend,
  readAgentMemory,
  resolveChatAgentBackend,
  saveAgentBackend,
  saveAgentCrons,
  writeAgentMemory,
} from "../src/agent-persona-store.js";

describe("agent persona store", () => {
  it("keeps keys, crons, and memory separate per agent", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "personas-"));
    await saveAgentBackend(root, "agent-a", {
      baseUrl: "http://127.0.0.1:9101/v1/chat/completions",
      apiKey: "sk-alpha-key",
      protocol: "openai_chat",
      model: "default",
    });
    await saveAgentBackend(root, "agent-b", {
      baseUrl: "http://127.0.0.1:9102/v1/chat/completions",
      apiKey: "sk-beta-key",
      protocol: "openai_chat",
      model: "default",
    });
    await saveAgentCrons(root, "agent-a", [{ id: "digest", name: "Alpha digest" }]);
    await saveAgentCrons(root, "agent-b", [{ id: "digest", name: "Beta digest" }]);
    await writeAgentMemory(root, "agent-a", "notes.md", "alpha remembers");
    await writeAgentMemory(root, "agent-b", "notes.md", "beta remembers");

    const alpha = await loadAgentBackend(root, "agent-a");
    const beta = await loadAgentBackend(root, "agent-b");
    expect(alpha?.apiKey).toBe("sk-alpha-key");
    expect(beta?.apiKey).toBe("sk-beta-key");
    expect(alpha?.baseUrl).not.toBe(beta?.baseUrl);
    expect(await listAgentCrons(root, "agent-a")).toEqual([
      { id: "digest", name: "Alpha digest" },
    ]);
    expect(await listAgentCrons(root, "agent-b")).toEqual([
      { id: "digest", name: "Beta digest" },
    ]);
    expect(await listAgentMemory(root, "agent-a")).toEqual(["notes.md"]);
    expect(await readAgentMemory(root, "agent-b", "notes.md")).toBe(
      "beta remembers",
    );
    expect(await readAgentMemory(root, "agent-a", "notes.md")).toBe(
      "alpha remembers",
    );
    expect(await listAgentMemory(root, "agent-b")).not.toContain("other.md");
  });

  it("uses the stored backend for that agent ahead of the process fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "personas-"));
    await saveAgentBackend(root, "agent-a", {
      baseUrl: "http://127.0.0.1:1/v1/chat/completions",
      apiKey: "sk-stored",
      protocol: "openai_chat",
      model: "default",
    });
    const resolved = await resolveChatAgentBackend({
      vaultRoot: root,
      agentId: "agent-a",
      fallback: {
        baseUrl: "http://127.0.0.1:2/v1/chat/completions",
        apiKey: "sk-process",
        protocol: "lanyard_harness",
        model: "default",
      },
    });
    expect(resolved?.apiKey).toBe("sk-stored");
    const other = await resolveChatAgentBackend({
      vaultRoot: root,
      agentId: "agent-b",
      fallback: {
        baseUrl: "http://127.0.0.1:2/v1/chat/completions",
        apiKey: "sk-process",
        protocol: "lanyard_harness",
        model: "default",
      },
    });
    expect(other?.apiKey).toBe("sk-process");
  });
});
