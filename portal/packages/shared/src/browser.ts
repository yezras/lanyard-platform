/**
 * SPA-safe @lanyard/shared barrel. Node-only harness invoke (spawn, fs)
 * stays on the main index export, not this graph.
 */
export * from "./relay/contract.js";
export * from "./relay/descriptor.js";
export * from "./relay/message-event.js";
export * from "./relay/portal-metadata.js";
export * from "./relay/brain-rpc.js";
export * from "./relay/frames.js";
export * from "./relay/serialize.js";
export * from "./fixtures/hermes-vectors.js";
export * from "./fixtures/artifact-agent-file-work.js";
export * from "./hermes/projects.js";
export * from "./tenant/host.js";
export * from "./rbac/path-access.js";
export * from "./rbac/path-project.js";
export * from "./workflow/run-vault.js";
export * from "./staging/paths.js";
export * from "./logging/index.js";
export * from "./document-pane/index.js";
export * from "./harness/turn.js";
export * from "./harness/inbound-work-item.js";
export * from "./harness/http.js";
export * from "./errors.js";
export * from "./mailbox/index.js";
export * from "./auth-identity.js";
export * from "./auth-planes.js";
export * from "./ops-secrets.js";
export * from "./toolbox/exec.js";
export * from "./toolbox/redact.js";
export * from "./toolbox/fake.js";
export * from "./toolbox/bind.js";

import { createLanyardWebDescriptor } from "./relay/descriptor.js";

/** Stable descriptor instance for relay handshake (#4). */
export const LANYARD_WEB_DESCRIPTOR = createLanyardWebDescriptor();
