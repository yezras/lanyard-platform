import {
  ACTION_CLASSES,
  ACTION_GATES,
  CONNECTOR_AUTH_KINDS,
  CONNECTOR_IDS,
  CONNECTOR_PRINCIPALS,
  CONNECTOR_RUNTIMES,
  type ActionClass,
  type ActionGate,
  type ConnectorAuthKind,
  type ConnectorId,
  type ConnectorPrincipal,
  type ConnectorRuntime,
} from "./types.js";

export class InvalidConnectorEnumError extends Error {
  readonly enumName: string;
  readonly value: unknown;
  readonly allowed: readonly string[];

  constructor(enumName: string, value: unknown, allowed: readonly string[]) {
    super(
      `invalid ${enumName}: ${JSON.stringify(value)} (allowed: ${allowed.join(", ")})`,
    );
    this.name = "InvalidConnectorEnumError";
    this.enumName = enumName;
    this.value = value;
    this.allowed = allowed;
  }
}

function includesString<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

export function isConnectorId(value: unknown): value is ConnectorId {
  return includesString(CONNECTOR_IDS, value);
}

export function isConnectorRuntime(value: unknown): value is ConnectorRuntime {
  return includesString(CONNECTOR_RUNTIMES, value);
}

export function isConnectorPrincipal(
  value: unknown,
): value is ConnectorPrincipal {
  return includesString(CONNECTOR_PRINCIPALS, value);
}

export function isConnectorAuthKind(
  value: unknown,
): value is ConnectorAuthKind {
  return includesString(CONNECTOR_AUTH_KINDS, value);
}

export function isActionClass(value: unknown): value is ActionClass {
  return includesString(ACTION_CLASSES, value);
}

export function isActionGate(value: unknown): value is ActionGate {
  return includesString(ACTION_GATES, value);
}

function parseEnum<T extends string>(
  enumName: string,
  allowed: readonly T[],
  value: unknown,
): T {
  if (includesString(allowed, value)) {
    return value;
  }
  throw new InvalidConnectorEnumError(enumName, value, allowed);
}

export function parseConnectorId(value: unknown): ConnectorId {
  return parseEnum("ConnectorId", CONNECTOR_IDS, value);
}

export function parseConnectorRuntime(value: unknown): ConnectorRuntime {
  return parseEnum("ConnectorRuntime", CONNECTOR_RUNTIMES, value);
}

export function parseConnectorPrincipal(value: unknown): ConnectorPrincipal {
  return parseEnum("ConnectorPrincipal", CONNECTOR_PRINCIPALS, value);
}

export function parseConnectorAuthKind(value: unknown): ConnectorAuthKind {
  return parseEnum("ConnectorAuthKind", CONNECTOR_AUTH_KINDS, value);
}

export function parseActionClass(value: unknown): ActionClass {
  return parseEnum("ActionClass", ACTION_CLASSES, value);
}

export function parseActionGate(value: unknown): ActionGate {
  return parseEnum("ActionGate", ACTION_GATES, value);
}
