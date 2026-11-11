import { CONNECTOR_CATALOG } from "./catalog.generated.js";

/** First-class custom runtimes. Live ids live in CP canonical_connectors. */
export type ConnectorId = (typeof CONNECTOR_CATALOG.connector_ids)[number];
export type FirstClassConnectorId = ConnectorId;
export type ConnectorRuntime =
  (typeof CONNECTOR_CATALOG.connector_runtimes)[number];
export type ConnectorPrincipal =
  (typeof CONNECTOR_CATALOG.connector_principals)[number];
export type ConnectorAuthKind =
  (typeof CONNECTOR_CATALOG.connector_auth_kinds)[number];
export type ActionClass = (typeof CONNECTOR_CATALOG.action_classes)[number];
export type ActionGate = (typeof CONNECTOR_CATALOG.action_gates)[number];

export const CONNECTOR_IDS = CONNECTOR_CATALOG.connector_ids;
export const FIRST_CLASS_CONNECTOR_IDS = CONNECTOR_IDS;
export const CONNECTOR_RUNTIMES = CONNECTOR_CATALOG.connector_runtimes;
export const CONNECTOR_PRINCIPALS = CONNECTOR_CATALOG.connector_principals;
export const CONNECTOR_AUTH_KINDS = CONNECTOR_CATALOG.connector_auth_kinds;
export const ACTION_CLASSES = CONNECTOR_CATALOG.action_classes;
export const ACTION_GATES = CONNECTOR_CATALOG.action_gates;
export const UNMAPPED_GATE = CONNECTOR_CATALOG.unmapped_gate;
export const CONNECTORS = CONNECTOR_CATALOG.connectors;
export const COMMAND_MAP = CONNECTOR_CATALOG.command_map;
export const ACTION_CLASS_GATES = CONNECTOR_CATALOG.action_class_gates;

type GateKeys = keyof typeof ACTION_CLASS_GATES;
type _AllClassesHaveGates = ActionClass extends GateKeys ? true : never;
type _NoExtraGates = GateKeys extends ActionClass ? true : never;
const _gatesCoverClasses: _AllClassesHaveGates = true;
const _noExtraGates: _NoExtraGates = true;
void _gatesCoverClasses;
void _noExtraGates;

export function gateForActionClass(actionClass: ActionClass): ActionGate {
  return ACTION_CLASS_GATES[actionClass];
}
