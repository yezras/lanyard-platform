import { randomUUID } from "node:crypto";

import { createLocalConnectorKms } from "../src/connector-kms.js";
import {
  ControlPlaneStore,
  type ControlPlaneStoreOptions,
} from "../src/store.js";

/**
 * Create an isolated Postgres-backed ControlPlaneStore for tests.
 *
 * Requires CONTROL_PLANE_DATABASE_URL or DATABASE_URL pointing at a reachable
 * Postgres (docker compose service `postgres` in local/CI).
 *
 * Each store uses a unique schema so parallel vitest files do not collide.
 */
export async function createTestStore(
  options: Omit<ControlPlaneStoreOptions, "databaseUrl" | "schema"> & {
    databaseUrl?: string;
  } = {},
): Promise<ControlPlaneStore> {
  const { store } = await createTestStoreWithSchema(options);
  return store;
}

export async function createTestStoreWithSchema(
  options: Omit<ControlPlaneStoreOptions, "databaseUrl" | "schema"> & {
    databaseUrl?: string;
  } = {},
): Promise<{ store: ControlPlaneStore; schema: string }> {
  const schema = `cp_test_${randomUUID().replace(/-/g, "")}`;
  const store = await ControlPlaneStore.create({
    ...options,
    schema,
    connectorKms:
      options.connectorKms === undefined
        ? createLocalConnectorKms()
        : options.connectorKms,
  });
  return { store, schema };
}
