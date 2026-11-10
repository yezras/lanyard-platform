/**
 * Redis key / channel layout for multi-relay routing bus (G6).
 * Prefixes are distinct from BFF G5 session keys (`bff:v1:sess:`).
 */

export const RELAY_KEY_PREFIX = "relay:v1:";

export function ownerKey(instanceId: string): string {
  return `${RELAY_KEY_PREFIX}owner:${instanceId}`;
}

export function revokedKey(instanceId: string): string {
  return `${RELAY_KEY_PREFIX}revoked:${instanceId}`;
}

export function nodeInstancesKey(nodeId: string): string {
  return `${RELAY_KEY_PREFIX}node:${nodeId}:instances`;
}

/** Shared jti cache prefix when G2a multi-relay is enabled (reserved). */
export function jtiKey(jti: string): string {
  return `${RELAY_KEY_PREFIX}jti:${jti}`;
}

export const BUS_CHANNEL = {
  deliver: `${RELAY_KEY_PREFIX}bus:deliver`,
  interrupt: `${RELAY_KEY_PREFIX}bus:interrupt`,
  revoke: `${RELAY_KEY_PREFIX}bus:revoke`,
  ownerChanged: `${RELAY_KEY_PREFIX}bus:owner_changed`,
  /** Per-correlation reply channel prefix for deliver/interrupt acks. */
  replyPrefix: `${RELAY_KEY_PREFIX}bus:reply:`,
} as const;

export function replyChannel(correlationId: string): string {
  return `${BUS_CHANNEL.replyPrefix}${correlationId}`;
}
