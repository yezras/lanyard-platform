/**
 * lp-gkh.9 — BFF corpus writer factory fail-closed wiring.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCorpusWriterFromConfig,
  loadChatCorpusHostConfig,
} from "../src/corpus-writer-factory.js";

describe("createCorpusWriterFromConfig", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it("returns null when unset (fail closed)", () => {
    expect(createCorpusWriterFromConfig({})).toBeNull();
    expect(
      createCorpusWriterFromConfig({ bucket: "only-bucket" }),
    ).toBeNull();
    expect(
      createCorpusWriterFromConfig({ fsRoot: "/tmp/no-bucket" }),
    ).toBeNull();
  });

  it("creates FS writer when bucket + fsRoot set", async () => {
    root = await mkdtemp(path.join(tmpdir(), "bff-corpus-factory-"));
    const writer = createCorpusWriterFromConfig({
      bucket: "lanyard-chat-corpus-lab",
      fsRoot: root,
    });
    expect(writer).not.toBeNull();
  });

  it("loadChatCorpusHostConfig reads env", () => {
    const cfg = loadChatCorpusHostConfig({
      CHAT_CORPUS_BUCKET: " my-bucket ",
      CHAT_CORPUS_FS_ROOT: " /tmp/corpus ",
    } as NodeJS.ProcessEnv);
    expect(cfg.bucket).toBe("my-bucket");
    expect(cfg.fsRoot).toBe("/tmp/corpus");
  });
});
