/**
 * Hermes relay ↔ connector wire contract v1 (EXPERIMENTAL).
 *
 * Source of truth (Hermes):
 * https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md
 *
 * TypeScript mirror of gateway/relay/descriptor.py and gateway/relay/ws_transport.py
 * frame envelopes. Used by Portal shared package for conformance tests only.
 */

/** Current relay contract version (additive-only within v1). */
export const RELAY_CONTRACT_VERSION = 1;

/**
 * WebSocket close code the connector sends when per-gateway secret is revoked.
 * @see relay-connector-contract.md §3.1 (deprovision / opt-out)
 */
export const RELAY_UNAUTHORIZED_CLOSE_CODE = 4401;

/** Canonical Lanyard web platform id for Portal connector handshake. */
export const LANYARD_WEB_PLATFORM = "lanyard_web";