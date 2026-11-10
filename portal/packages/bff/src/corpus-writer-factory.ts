/**
 * Host wiring for L10 CorpusWriter (lp-gkh.9).
 *
 * Fail closed: no writer unless explicitly configured.
 * Lab / MockLab: CHAT_CORPUS_BUCKET + CHAT_CORPUS_FS_ROOT → durable FS store
 *   (survives BFF restart; key layout matches S3).
 * Production AWS S3: inject a host adapter (no @aws-sdk in @lanyard/chat-corpus).
 */

import {
  FsCorpusObjectStore,
  S3CorpusWriter,
  type CorpusWriter,
} from "@lanyard/chat-corpus";
import { createLogger } from "@lanyard/shared";

const log = createLogger({ service: "bff" });

export type ChatCorpusHostConfig = {
  /**
   * Bare bucket name (no s3://). Required with a store backend.
   * Env: CHAT_CORPUS_BUCKET
   */
  bucket?: string;
  /**
   * Local durable object root for MockLab / offline proof.
   * Env: CHAT_CORPUS_FS_ROOT
   * When set with bucket, creates FsCorpusObjectStore + S3CorpusWriter.
   */
  fsRoot?: string;
};

export function loadChatCorpusHostConfig(
  env: NodeJS.ProcessEnv = process.env,
): ChatCorpusHostConfig {
  return {
    bucket: env.CHAT_CORPUS_BUCKET?.trim() || undefined,
    fsRoot: env.CHAT_CORPUS_FS_ROOT?.trim() || undefined,
  };
}

/**
 * Build an optional CorpusWriter for createApp bindings.
 * Returns null when corpus host storage is not configured (capture no-op).
 */
export function createCorpusWriterFromConfig(
  config: ChatCorpusHostConfig = loadChatCorpusHostConfig(),
): CorpusWriter | null {
  const bucket = config.bucket?.trim();
  const fsRoot = config.fsRoot?.trim();

  if (!bucket && !fsRoot) {
    return null;
  }

  if (!bucket) {
    log.warn("chat_corpus_misconfigured", {
      reason: "CHAT_CORPUS_FS_ROOT set without CHAT_CORPUS_BUCKET",
    });
    return null;
  }

  if (!fsRoot) {
    // Real S3 requires a host-injected adapter (not bundled here).
    log.warn("chat_corpus_misconfigured", {
      reason:
        "CHAT_CORPUS_BUCKET set without CHAT_CORPUS_FS_ROOT (lab) or host S3 adapter",
    });
    return null;
  }

  const store = new FsCorpusObjectStore({ rootDir: fsRoot });
  const writer = new S3CorpusWriter({ bucket, store });
  log.info("chat_corpus_writer_ready", {
    backend: "fs",
    bucket,
    // Path only — never object bodies.
    fs_root_set: true,
  });
  return writer;
}
