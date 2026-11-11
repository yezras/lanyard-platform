import type { SqlClient } from "./db.js";

/**
 * Apply control-plane schema (idempotent CREATE IF NOT EXISTS + column/constraint ensure).
 *
 * Schema boundary (cbd-mta.3.1 / cbd-mta.3.3 / G4.1):
 * - Metadata only: tenants, users/OIDC subjects, memberships/roles/path grants,
 *   gateway instances (credential **hashes** + registry health), tenant
 *   deployments/resource refs (non-secret AWS inventory), projects (vault
 *   **paths**), session-share grants (thread ids), audit actions.
 * - **Never** store canonical Company Brain file bodies, chat bodies, reusable
 *   plaintext relay secrets, Terraform state, or raw secret values — vault
 *   content lives on the customer host and is reached only via Brain RPC
 *   (deploy `references/brain-rpc-contract.md` and
 *   `references/deployment-resource-registry.md`).
 * - Connector OAuth / WhatsApp session material is KMS envelope ciphertext on
 *   `connector_connections.secrets_ciphertext` (lp-xhf4.2). Never plaintext.
 * - Class C registry connector tokens are KMS envelopes on
 *   `tenant_connector_class_c_secrets` (lp-hdzm.24). Never plaintext. Never guest.
 * - Tenant rows carry `tenant_id` FKs; platform-global entities are limited to
 *   `tenants` (root) and optional null-tenant audit rows. AWS IDs are metadata,
 *   not auth.
 *
 * Full greenfield Postgres schema — SQLite ALTER/PRAGMA paths removed (G4.1).
 * Data migration from existing SQLite files is G4.2.
 * RLS: deferred (see docs/control-plane-schema-boundary.md).
 */
export async function migrateControlPlaneSchema(db: SqlClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenant_id TEXT PRIMARY KEY,
      tenant_slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      interaction_export_enabled INTEGER NOT NULL DEFAULT 0,
      retention_mode TEXT NOT NULL DEFAULT 'none'
        CHECK (retention_mode IN ('none', 'metadata_only', 'interaction_export')),
      -- lp-gkh.6 / plan 0011: L10 chat corpus enablement (fail closed)
      chat_corpus_enabled INTEGER NOT NULL DEFAULT 0,
      chat_corpus_retention_days INTEGER,
      relay_tier TEXT NOT NULL DEFAULT 'shared'
        CHECK (relay_tier IN ('shared', 'dedicated')),
      dedicated_relay_wss_url TEXT
      -- lp-k5c4.13 Phase 10 drop: chat_delivery column removed from request path (rollback: ADD COLUMN chat_delivery TEXT CHECK (IN ('relay','harness')))
    );

    CREATE TABLE IF NOT EXISTS gateway_instances (
      instance_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      secret_hash TEXT NOT NULL,
      secret_salt TEXT NOT NULL,
      previous_secret_hash TEXT,
      previous_secret_salt TEXT,
      previous_secret_expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      -- cbd-mta.3.3 registry fields (metadata only; not auth)
      label TEXT,
      last_seen_at TEXT,
      health_status TEXT NOT NULL DEFAULT 'unknown',
      credential_rotated_at TEXT,
      secret_param_arn TEXT,
      ec2_instance_id TEXT,
      aws_region TEXT,
      -- lp-nye / plan §2.3: Daytona dual-run fields (metadata only; not auth)
      runtime_kind TEXT NOT NULL DEFAULT 'ec2'
        CHECK (runtime_kind IN ('ec2', 'daytona')),
      sandbox_id TEXT,
      presence TEXT NOT NULL DEFAULT 'offline'
        CHECK (presence IN ('offline', 'waking', 'online', 'error')),
      agent_snapshot_id TEXT,
      s3_vault_prefix TEXT,
      -- lp-omt: idle grace clock for orchestrator reaper / signal-activity
      last_activity_at TEXT,
      -- lp-053: mid-turn protection (block idle stop while agent turn/tools active)
      mid_turn BOOLEAN NOT NULL DEFAULT FALSE,
      mid_turn_until TEXT,
      -- lp-k5c4.13 Phase 10 drop: chat_delivery removed (rollback: ADD COLUMN chat_delivery TEXT CHECK)
      -- lp-xhf4.6 / plan 0010: user-principal connectors bind scope=user.
      -- owner_user_id FK is added after users exists (table order).
      scope TEXT NOT NULL DEFAULT 'tenant'
        CHECK (scope IN ('tenant', 'user')),
      owner_user_id TEXT,
      CHECK (
        (scope = 'tenant' AND owner_user_id IS NULL)
        OR (scope = 'user' AND owner_user_id IS NOT NULL)
      ),
      -- lp-zoh.2 / plan 0010: tenant primary for routing fallback. Exactly one
      -- active tenant-scope primary per tenant is enforced by the partial
      -- unique index created after ensureOptionalColumns (latest active wins).
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      -- lp-zoh.2 / plan 0010: dual vault prefixes.
      -- shared = tenants/{tid}/vault/shared/
      -- personal (scope=user only) = tenants/{tid}/users/{uid}/vault/
      s3_shared_vault_prefix TEXT,
      s3_personal_vault_prefix TEXT,
      -- lp-vqr0.4: Mountpoint write probe. Independent of presence
      -- (online = agent_ready; file tools wait on this flag).
      vault_writable BOOLEAN NOT NULL DEFAULT FALSE,
      -- lp-k5c4.4: spine toolbox hot-window deadline (idle reaper honors this
      -- instead of 10m grace). ISO timestamp; null when unset.
      stop_after TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_gateway_instances_tenant
      ON gateway_instances(tenant_id);

    CREATE INDEX IF NOT EXISTS idx_gateway_instances_tenant_active
      ON gateway_instances(tenant_id)
      WHERE revoked_at IS NULL;

    -- scope / owner_user_id indexes are created after ensureOptionalColumns
    -- so existing DBs (CREATE TABLE IF NOT EXISTS is a no-op) get ADD COLUMN
    -- before CREATE INDEX. First-boot CREATE TABLE already includes the columns.

    -- Current deployment metadata per tenant (not Terraform state).
    CREATE TABLE IF NOT EXISTS tenant_deployments (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(tenant_id),
      hosting_track TEXT NOT NULL
        CHECK (hosting_track IN ('lanyard_hosted', 'customer_account')),
      isolation_mode TEXT NOT NULL
        CHECK (isolation_mode IN ('account', 'vpc_interim', 'customer_account')),
      aws_account_id TEXT,
      aws_region TEXT,
      project_name TEXT,
      status TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN (
          'registered', 'provisioning', 'active', 'degraded', 'offboarding', 'retired'
        )),
      client_core_version TEXT,
      hermes_version TEXT,
      primary_instance_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      retired_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tenant_deployments_status
      ON tenant_deployments(status);

    -- Minimal non-secret AWS / platform resource references (not tfstate).
    CREATE TABLE IF NOT EXISTS tenant_resource_refs (
      resource_ref_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      resource_kind TEXT NOT NULL
        CHECK (resource_kind IN (
          'ec2_instance', 'ebs_volume', 'kms_key', 'iam_role',
          'security_group', 'subnet', 'vpc', 'ssm_parameter',
          'secrets_manager_secret', 'log_group', 'dlm_policy',
          's3_artifact_prefix', 'other'
        )),
      name TEXT NOT NULL,
      aws_id TEXT,
      arn TEXT,
      secret_arn TEXT,
      aws_region TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'replaced', 'retired')),
      last_seen_at TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, resource_kind, name)
    );

    CREATE INDEX IF NOT EXISTS idx_tenant_resource_refs_tenant
      ON tenant_resource_refs(tenant_id);

    CREATE INDEX IF NOT EXISTS idx_tenant_resource_refs_tenant_active
      ON tenant_resource_refs(tenant_id)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS audit_log (
      audit_id TEXT PRIMARY KEY,
      tenant_id TEXT REFERENCES tenants(tenant_id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      actor TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      -- cbd-mta.3.3 audit boundary first-class fields
      instance_id TEXT,
      result TEXT NOT NULL DEFAULT 'success',
      request_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_tenant
      ON audit_log(tenant_id);

    CREATE INDEX IF NOT EXISTS idx_audit_log_created
      ON audit_log(created_at);

    CREATE INDEX IF NOT EXISTS idx_audit_log_instance
      ON audit_log(instance_id);

    CREATE INDEX IF NOT EXISTS idx_audit_log_request
      ON audit_log(request_id)
      WHERE request_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      email TEXT NOT NULL,
      password_hash TEXT,
      password_salt TEXT,
      google_sub TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      tenant_role TEXT NOT NULL DEFAULT 'member'
        CHECK (tenant_role IN ('tenant_admin', 'member')),
      created_at TEXT NOT NULL,
      UNIQUE(tenant_id, email)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_google_sub
      ON users(tenant_id, google_sub)
      WHERE google_sub IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_users_tenant
      ON users(tenant_id);

    CREATE TABLE IF NOT EXISTS roles (
      role_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      name TEXT NOT NULL,
      hermes_profile TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(tenant_id, name)
    );

    CREATE TABLE IF NOT EXISTS role_path_prefixes (
      role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
      path_prefix TEXT NOT NULL,
      PRIMARY KEY (role_id, path_prefix)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      parent_project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      vault_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_tenant_path ON projects(tenant_id, vault_path);

    CREATE TABLE IF NOT EXISTS session_share_grants (
      grant_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      thread_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(user_id),
      grantee_user_id TEXT NOT NULL REFERENCES users(user_id),
      mode TEXT NOT NULL
        CHECK (mode IN ('read', 'collaborate')),
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_share_grants_tenant
      ON session_share_grants(tenant_id);

    CREATE INDEX IF NOT EXISTS idx_session_share_grants_grantee
      ON session_share_grants(tenant_id, grantee_user_id)
      WHERE revoked_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_session_share_grants_thread
      ON session_share_grants(tenant_id, thread_id)
      WHERE revoked_at IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_share_grants_active
      ON session_share_grants(tenant_id, thread_id, grantee_user_id)
      WHERE revoked_at IS NULL;

    -- lp-hdzm.4: live connector list is the registry, not a four-id CHECK.
    CREATE TABLE IF NOT EXISTS canonical_connectors (
      id TEXT PRIMARY KEY
        CHECK (id ~ '^[a-z][a-z0-9-]{0,63}$'),
      domain TEXT,
      label TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      seeded INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'seeded'
        CHECK (source IN ('seeded', 'integrations.sh', 'custom')),
      source_entry_id TEXT,
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_connectors_source_entry
      ON canonical_connectors(source_entry_id)
      WHERE source_entry_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS canonical_connector_aliases (
      alias TEXT PRIMARY KEY,
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id)
    );

    CREATE INDEX IF NOT EXISTS idx_canonical_connector_aliases_connector
      ON canonical_connector_aliases(connector_id);

    -- lp-xhf4.2: portal connectors. Ciphertext is KMS envelope JSON, not tokens.
    CREATE TABLE IF NOT EXISTS tenant_connector_entitlements (
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id),
      enabled INTEGER NOT NULL DEFAULT 0,
      hubspot_portal_id TEXT,
      surfaces_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, connector_id),
      CHECK (hubspot_portal_id IS NULL OR connector_id = 'hubspot')
    );

    CREATE TABLE IF NOT EXISTS role_connector_grants (
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      role_id TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id),
      enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, role_id, connector_id)
    );

    CREATE INDEX IF NOT EXISTS idx_role_connector_grants_role
      ON role_connector_grants(role_id);

    CREATE TABLE IF NOT EXISTS connector_connections (
      connection_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id),
      status TEXT NOT NULL DEFAULT 'not_connected'
        CHECK (status IN ('not_connected', 'pairing', 'connected', 'needs_reauth')),
      account_label TEXT,
      sticky_json TEXT NOT NULL DEFAULT '{}',
      secrets_ciphertext TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, user_id, connector_id)
    );

    CREATE INDEX IF NOT EXISTS idx_connector_connections_tenant_user
      ON connector_connections(tenant_id, user_id);

    -- lp-hdzm.6: person grant is row presence (tenant, user, connector).
    CREATE TABLE IF NOT EXISTS person_connector_grants (
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id),
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, connector_id)
    );

    CREATE INDEX IF NOT EXISTS idx_person_connector_grants_user
      ON person_connector_grants(tenant_id, user_id);

    -- lp-hdzm.23: member subset is a tool-name allowlist on (tenant, connector).
    CREATE TABLE IF NOT EXISTS connector_member_subsets (
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id),
      tool_names_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, connector_id)
    );

    -- lp-2qs.4: Class B ops-managed tenant provider secrets (dual-auth
    -- credential planes §6). One KMS ciphertext envelope per (tenant, slot);
    -- closed slot allowlist mirrors @lanyard/shared ops-secrets ids.
    CREATE TABLE IF NOT EXISTS tenant_provider_secrets (
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      slot_id TEXT NOT NULL CHECK (slot_id IN (
        'OPENAI_API_KEY', 'XAI_API_KEY', 'ANTHROPIC_API_KEY',
        'OPENROUTER_API_KEY', 'META_API_KEY', 'CORP_LLM_API_KEY',
        'POOLSIDE_API_KEY', 'LITELLM_MASTER_KEY',
        'xai-grok', 'xai-oauth', 'openai-codex'
      )),
      secrets_ciphertext TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, slot_id)
    );

    -- lp-hdzm.24: Class C tenant-principal registry secrets. One KMS
    -- envelope per (tenant, connector, surface). Never plaintext. Never
    -- first-class google/hubspot/whatsapp/github (those stay Class A).
    CREATE TABLE IF NOT EXISTS tenant_connector_class_c_secrets (
      tenant_id TEXT NOT NULL REFERENCES tenants(tenant_id),
      connector_id TEXT NOT NULL REFERENCES canonical_connectors(id),
      surface_id TEXT NOT NULL CHECK (surface_id IN ('mcp', 'api', 'cli')),
      secrets_ciphertext TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, connector_id, surface_id)
    );

    CREATE INDEX IF NOT EXISTS idx_class_c_secrets_connector
      ON tenant_connector_class_c_secrets(tenant_id, connector_id);
  `);

  // Defense-in-depth: reject cross-tenant user↔role membership at the DB layer
  // even if application checks are bypassed (raw SQL / future code paths).
  await db.exec(`
    CREATE OR REPLACE FUNCTION enforce_user_roles_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      user_tenant TEXT;
      role_tenant TEXT;
    BEGIN
      SELECT tenant_id INTO user_tenant FROM users WHERE user_id = NEW.user_id;
      SELECT tenant_id INTO role_tenant FROM roles WHERE role_id = NEW.role_id;
      IF user_tenant IS NULL THEN
        RAISE EXCEPTION 'user_roles: user % not found', NEW.user_id;
      END IF;
      IF role_tenant IS NULL THEN
        RAISE EXCEPTION 'user_roles: role % not found', NEW.role_id;
      END IF;
      IF user_tenant IS DISTINCT FROM role_tenant THEN
        RAISE EXCEPTION 'user_roles: cross-tenant assignment denied (user tenant %, role tenant %)',
          user_tenant, role_tenant;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_user_roles_same_tenant ON user_roles;
    CREATE TRIGGER trg_user_roles_same_tenant
      BEFORE INSERT OR UPDATE ON user_roles
      FOR EACH ROW
      EXECUTE FUNCTION enforce_user_roles_same_tenant();
  `);

  // Session-share owner/grantee must belong to the grant's tenant.
  await db.exec(`
    CREATE OR REPLACE FUNCTION enforce_session_share_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      owner_tenant TEXT;
      grantee_tenant TEXT;
    BEGIN
      SELECT tenant_id INTO owner_tenant FROM users WHERE user_id = NEW.owner_user_id;
      SELECT tenant_id INTO grantee_tenant FROM users WHERE user_id = NEW.grantee_user_id;
      IF owner_tenant IS NULL OR owner_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'session_share_grants: owner % not in tenant %',
          NEW.owner_user_id, NEW.tenant_id;
      END IF;
      IF grantee_tenant IS NULL OR grantee_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'session_share_grants: grantee % not in tenant %',
          NEW.grantee_user_id, NEW.tenant_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_session_share_same_tenant ON session_share_grants;
    CREATE TRIGGER trg_session_share_same_tenant
      BEFORE INSERT OR UPDATE ON session_share_grants
      FOR EACH ROW
      EXECUTE FUNCTION enforce_session_share_same_tenant();
  `);

  // Project parent must share tenant (prevents cross-tenant parent links).
  await db.exec(`
    CREATE OR REPLACE FUNCTION enforce_project_parent_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      parent_tenant TEXT;
    BEGIN
      IF NEW.parent_project_id IS NULL THEN
        RETURN NEW;
      END IF;
      SELECT tenant_id INTO parent_tenant
        FROM projects WHERE project_id = NEW.parent_project_id;
      IF parent_tenant IS NULL THEN
        RAISE EXCEPTION 'projects: parent % not found', NEW.parent_project_id;
      END IF;
      IF parent_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'projects: cross-tenant parent denied';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_project_parent_same_tenant ON projects;
    CREATE TRIGGER trg_project_parent_same_tenant
      BEFORE INSERT OR UPDATE ON projects
      FOR EACH ROW
      EXECUTE FUNCTION enforce_project_parent_same_tenant();
  `);

  await db.exec(`
    CREATE OR REPLACE FUNCTION enforce_role_connector_grant_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      role_tenant TEXT;
    BEGIN
      SELECT tenant_id INTO role_tenant FROM roles WHERE role_id = NEW.role_id;
      IF role_tenant IS NULL THEN
        RAISE EXCEPTION 'role_connector_grants: role % not found', NEW.role_id;
      END IF;
      IF role_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'role_connector_grants: cross-tenant grant denied (role tenant %, grant tenant %)',
          role_tenant, NEW.tenant_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_role_connector_grant_same_tenant ON role_connector_grants;
    CREATE TRIGGER trg_role_connector_grant_same_tenant
      BEFORE INSERT OR UPDATE ON role_connector_grants
      FOR EACH ROW
      EXECUTE FUNCTION enforce_role_connector_grant_same_tenant();
  `);

  await db.exec(`
    CREATE OR REPLACE FUNCTION enforce_connector_connection_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      user_tenant TEXT;
    BEGIN
      SELECT tenant_id INTO user_tenant FROM users WHERE user_id = NEW.user_id;
      IF user_tenant IS NULL THEN
        RAISE EXCEPTION 'connector_connections: user % not found', NEW.user_id;
      END IF;
      IF user_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'connector_connections: cross-tenant connection denied (user tenant %, row tenant %)',
          user_tenant, NEW.tenant_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_connector_connection_same_tenant ON connector_connections;
    CREATE TRIGGER trg_connector_connection_same_tenant
      BEFORE INSERT OR UPDATE ON connector_connections
      FOR EACH ROW
      EXECUTE FUNCTION enforce_connector_connection_same_tenant();

    CREATE OR REPLACE FUNCTION enforce_person_connector_grant_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      user_tenant TEXT;
    BEGIN
      SELECT tenant_id INTO user_tenant FROM users WHERE user_id = NEW.user_id;
      IF user_tenant IS NULL THEN
        RAISE EXCEPTION 'person_connector_grants: user % not found', NEW.user_id;
      END IF;
      IF user_tenant IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'person_connector_grants: cross-tenant grant denied (user tenant %, grant tenant %)',
          user_tenant, NEW.tenant_id;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_person_connector_grant_same_tenant ON person_connector_grants;
    CREATE TRIGGER trg_person_connector_grant_same_tenant
      BEFORE INSERT OR UPDATE ON person_connector_grants
      FOR EACH ROW
      EXECUTE FUNCTION enforce_person_connector_grant_same_tenant();

    CREATE OR REPLACE FUNCTION enforce_gateway_instance_owner_same_tenant()
    RETURNS TRIGGER AS $$
    DECLARE
      owner_tenant TEXT;
    BEGIN
      IF NEW.scope = 'user' THEN
        SELECT tenant_id INTO owner_tenant FROM users WHERE user_id = NEW.owner_user_id;
        IF owner_tenant IS NULL OR owner_tenant IS DISTINCT FROM NEW.tenant_id THEN
          RAISE EXCEPTION 'gateway_instances: owner % not in tenant %',
            NEW.owner_user_id, NEW.tenant_id;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_gateway_instance_owner_same_tenant ON gateway_instances;
    CREATE TRIGGER trg_gateway_instance_owner_same_tenant
      BEFORE INSERT OR UPDATE ON gateway_instances
      FOR EACH ROW
      EXECUTE FUNCTION enforce_gateway_instance_owner_same_tenant();
  `);

  await seedCanonicalConnectors(db);

  // Upgrade path: tables created before cbd-mta.3.3 get new columns.
  await ensureOptionalColumns(db);
  await db.exec(`
    UPDATE users
    SET display_name = split_part(email, '@', 1)
    WHERE display_name IS NULL OR display_name = '';
  `);
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_gateway_instances_tenant_scope
      ON gateway_instances(tenant_id, scope)
      WHERE revoked_at IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_instances_user_owner
      ON gateway_instances(tenant_id, owner_user_id)
      WHERE revoked_at IS NULL AND scope = 'user';
  `);
  // lp-zoh.2 / plan 0010: backfill exactly one primary per tenant before the
  // unique partial index below (existing DBs have is_primary=FALSE rows).
  // Latest created_at active tenant-scope row wins — mirrors
  // getPrimaryActiveInstance "latest wins". Backfill MUST precede the index.
  await db.exec(`
    UPDATE gateway_instances
    SET is_primary = TRUE
    WHERE COALESCE(scope, 'tenant') = 'tenant'
      AND revoked_at IS NULL
      AND is_primary = FALSE
      AND created_at = (
        SELECT MAX(g2.created_at)
        FROM gateway_instances g2
        WHERE g2.tenant_id = gateway_instances.tenant_id
          AND COALESCE(g2.scope, 'tenant') = 'tenant'
          AND g2.revoked_at IS NULL
      );
  `);
  await db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gateway_instances_tenant_primary
      ON gateway_instances(tenant_id)
      WHERE revoked_at IS NULL AND scope = 'tenant' AND is_primary;
  `);
  // Upgrade path: existing tables created without FKs/checks get constraints
  // attached when missing (greenfield CREATE already includes them).
  await ensureOptionalConstraints(db);

  // lp-k5c4.3 / plan 0019 §4.3: inbound work spine leases (BFF enqueues).
  // Keep in sync with portal/packages/bff/src/inbound-queue-pg.ts.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_rooms (
      tenant_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id, thread_id),
      lease_owner TEXT,
      lease_until TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS inbound_work_items (
      item_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'leased', 'started', 'done', 'failed')),
      correlation_id TEXT NOT NULL,
      enqueue_at BIGINT NOT NULL,
      lease_owner TEXT,
      lease_until TIMESTAMPTZ,
      turn_id TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      FOREIGN KEY (tenant_id, thread_id) REFERENCES inbound_rooms (tenant_id, thread_id)
    );

    CREATE INDEX IF NOT EXISTS inbound_work_items_room_open
      ON inbound_work_items (tenant_id, thread_id, enqueue_at, item_id)
      WHERE status IN ('queued', 'leased', 'started');
  `);

  // lp-k5c4.13 Phase 10 — drop chat_delivery persist from request path.
  // EC2 residual lp-k5c4.14 is closed (0 runtime_kind=ec2). Every tenant is
  // Daytona; request path is always spine when HARNESS_URL is wired.
  // Rollback (if needed before column is recreated on a fresh deploy):
  //   ALTER TABLE tenants ADD COLUMN chat_delivery TEXT CHECK (chat_delivery IS NULL OR chat_delivery IN ('relay','harness'));
  //   ALTER TABLE gateway_instances ADD COLUMN chat_delivery TEXT CHECK (chat_delivery IS NULL OR chat_delivery IN ('relay','harness'));
  //   ALTER TABLE tenants ADD CONSTRAINT tenants_chat_delivery_check CHECK (chat_delivery IS NULL OR chat_delivery IN ('relay','harness'));
  //   ALTER TABLE gateway_instances ADD CONSTRAINT gateway_instances_chat_delivery_check CHECK (chat_delivery IS NULL OR chat_delivery IN ('relay','harness'));
  await db.exec(`
    ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_chat_delivery_check;
    ALTER TABLE gateway_instances DROP CONSTRAINT IF EXISTS gateway_instances_chat_delivery_check;
    ALTER TABLE tenants DROP COLUMN IF EXISTS chat_delivery;
    ALTER TABLE gateway_instances DROP COLUMN IF EXISTS chat_delivery;
  `);
}

const CANONICAL_CONNECTOR_SEED_AT = "2026-08-26T00:00:00.000Z";

/**
 * Seed first-class ids and google/hubspot domain aliases. Idempotent.
 * Must run before FKs attach on upgrade DBs that already have entitlement rows.
 */
async function seedCanonicalConnectors(db: SqlClient): Promise<void> {
  await db.exec(`
    INSERT INTO canonical_connectors
      (id, domain, label, archived, seeded, snapshot, created_at)
    VALUES
      ('google', 'google.com', 'Google', 0, 1, '{}'::jsonb, '${CANONICAL_CONNECTOR_SEED_AT}'),
      ('hubspot', 'hubspot.com', 'HubSpot', 0, 1, '{}'::jsonb, '${CANONICAL_CONNECTOR_SEED_AT}'),
      ('whatsapp', 'whatsapp.com', 'WhatsApp', 0, 1, '{}'::jsonb, '${CANONICAL_CONNECTOR_SEED_AT}'),
      ('github', 'github.com', 'GitHub', 0, 1, '{}'::jsonb, '${CANONICAL_CONNECTOR_SEED_AT}')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO canonical_connector_aliases (alias, connector_id)
    VALUES
      ('gmail.com', 'google'),
      ('google.com', 'google'),
      ('googleapis.com', 'google'),
      ('*.google.com', 'google'),
      ('hubspot.com', 'hubspot'),
      ('hubapi.com', 'hubspot'),
      ('*.hubspot.com', 'hubspot'),
      ('*.hubapi.com', 'hubspot')
    ON CONFLICT (alias) DO NOTHING;
  `);
}

/**
 * Idempotent ADD COLUMN for DBs that already had older CREATE TABLE definitions.
 * Safe to re-run; ignores duplicate_column.
 */
async function ensureOptionalColumns(db: SqlClient): Promise<void> {
  const statements = [
    `ALTER TABLE gateway_instances ADD COLUMN label TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN last_seen_at TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN health_status TEXT NOT NULL DEFAULT 'unknown'`,
    `ALTER TABLE gateway_instances ADD COLUMN credential_rotated_at TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN secret_param_arn TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN ec2_instance_id TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN aws_region TEXT`,
    // lp-nye: Daytona lifecycle fields on gateway_instances (default keeps EC2 path)
    `ALTER TABLE gateway_instances ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'ec2'`,
    `ALTER TABLE gateway_instances ADD COLUMN sandbox_id TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN presence TEXT NOT NULL DEFAULT 'offline'`,
    `ALTER TABLE gateway_instances ADD COLUMN agent_snapshot_id TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN s3_vault_prefix TEXT`,
    // lp-omt: durable last_activity_at for presence store / idle reaper
    `ALTER TABLE gateway_instances ADD COLUMN last_activity_at TEXT`,
    // lp-053: mid-turn lock + timeout safety for idle reaper
    `ALTER TABLE gateway_instances ADD COLUMN mid_turn BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE gateway_instances ADD COLUMN mid_turn_until TEXT`,
    // lp-gkh.6: L10 chat corpus fields on tenants (default off / null retention)
    `ALTER TABLE tenants ADD COLUMN chat_corpus_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE tenants ADD COLUMN chat_corpus_retention_days INTEGER`,
    // lp-k5c4.13 Phase 10 drop — chat_delivery removed (rollback adds it back)
    `ALTER TABLE audit_log ADD COLUMN instance_id TEXT`,
    `ALTER TABLE audit_log ADD COLUMN result TEXT NOT NULL DEFAULT 'success'`,
    `ALTER TABLE audit_log ADD COLUMN request_id TEXT`,
    // lp-xhf4.6: user-scope instances for user-principal connectors
    `ALTER TABLE gateway_instances ADD COLUMN scope TEXT NOT NULL DEFAULT 'tenant'`,
    `ALTER TABLE gateway_instances ADD COLUMN owner_user_id TEXT`,
    // lp-zoh.2 / plan 0010: tenant-primary flag + dual vault prefixes
    `ALTER TABLE gateway_instances ADD COLUMN is_primary BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE gateway_instances ADD COLUMN s3_shared_vault_prefix TEXT`,
    `ALTER TABLE gateway_instances ADD COLUMN s3_personal_vault_prefix TEXT`,
    // lp-vqr0.4: vault_writable independent of presence (online = agent_ready)
    `ALTER TABLE gateway_instances ADD COLUMN vault_writable BOOLEAN NOT NULL DEFAULT FALSE`,
    // lp-hdzm.6: ops provision name + Admin|Member (not Hermes roles)
    `ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN tenant_role TEXT NOT NULL DEFAULT 'member'`,
    // lp-hdzm.19: promote/custom source + unique catalog entry id
    `ALTER TABLE canonical_connectors ADD COLUMN source TEXT NOT NULL DEFAULT 'seeded'`,
    `ALTER TABLE canonical_connectors ADD COLUMN source_entry_id TEXT`,
    // lp-hdzm.21: onboard surfaces on the entitlement row
    `ALTER TABLE tenant_connector_entitlements ADD COLUMN surfaces_json TEXT NOT NULL DEFAULT '[]'`,
    // lp-k5c4.4: spine toolbox hot-window deadline for idle reaper
    `ALTER TABLE gateway_instances ADD COLUMN stop_after TEXT`,
  ];

  for (const sql of statements) {
    try {
      await db.exec(sql);
    } catch (error) {
      // 42701 duplicate_column
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "";
      if (code === "42701" || /already exists/i.test(String(error))) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * Idempotent ALTER for FKs / checks when missing.
 * Safe to re-run; ignores duplicate_object.
 */
async function ensureOptionalConstraints(db: SqlClient): Promise<void> {
  const statements = [
    `ALTER TABLE audit_log
       ADD CONSTRAINT audit_log_tenant_id_fkey
       FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE SET NULL`,
    `ALTER TABLE tenants
       ADD CONSTRAINT tenants_retention_mode_check
       CHECK (retention_mode IN ('none', 'metadata_only', 'interaction_export'))`,
    `ALTER TABLE tenants
       ADD CONSTRAINT tenants_relay_tier_check
       CHECK (relay_tier IN ('shared', 'dedicated'))`,
    `ALTER TABLE session_share_grants
       ADD CONSTRAINT session_share_grants_mode_check
       CHECK (mode IN ('read', 'collaborate'))`,
    `ALTER TABLE gateway_instances
       ADD CONSTRAINT gateway_instances_health_status_check
       CHECK (health_status IN (
         'unknown', 'healthy', 'degraded', 'unreachable', 'revoked'
       ))`,
    `ALTER TABLE gateway_instances
       ADD CONSTRAINT gateway_instances_runtime_kind_check
       CHECK (runtime_kind IN ('ec2', 'daytona'))`,
    `ALTER TABLE gateway_instances
       ADD CONSTRAINT gateway_instances_presence_check
       CHECK (presence IN ('offline', 'waking', 'online', 'error'))`,
    `ALTER TABLE gateway_instances
       ADD CONSTRAINT gateway_instances_scope_check
       CHECK (scope IN ('tenant', 'user'))`,
    `ALTER TABLE gateway_instances
       ADD CONSTRAINT gateway_instances_scope_owner_check
       CHECK (
         (scope = 'tenant' AND owner_user_id IS NULL)
         OR (scope = 'user' AND owner_user_id IS NOT NULL)
       )`,
    `ALTER TABLE gateway_instances
       ADD CONSTRAINT gateway_instances_owner_user_fkey
       FOREIGN KEY (owner_user_id) REFERENCES users(user_id)`,
    `ALTER TABLE audit_log
       ADD CONSTRAINT audit_log_result_check
       CHECK (result IN ('success', 'failure', 'denied', 'partial'))`,
    // lp-hdzm.4 / lp-hdzm.34: live list is canonical_connectors. Drop the
    // four-id CHECK (any auto name). Postgres stores `IN (...)` as
    // `= ANY (ARRAY[...])`, so matching only `connector_id IN` left the
    // live RDS constraint in place and Stripe onboard 500'd.
    `DO $$
     DECLARE r record;
     BEGIN
       FOR r IN
         SELECT conrelid, conname
         FROM pg_constraint
         WHERE contype = 'c'
           AND conrelid IN (
             'tenant_connector_entitlements'::regclass,
             'role_connector_grants'::regclass,
             'connector_connections'::regclass,
             'person_connector_grants'::regclass
           )
           AND (
             pg_get_constraintdef(oid) ILIKE '%connector_id IN%'
             OR pg_get_constraintdef(oid) ILIKE '%connector_id = ANY%'
           )
           AND pg_get_constraintdef(oid) NOT ILIKE '%hubspot_portal_id%'
       LOOP
         EXECUTE format(
           'ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I',
           r.conrelid::regclass,
           r.conname
         );
       END LOOP;
     END $$`,
    `ALTER TABLE tenant_connector_entitlements
       ADD CONSTRAINT tenant_connector_entitlements_connector_id_fkey
       FOREIGN KEY (connector_id) REFERENCES canonical_connectors(id)`,
    `ALTER TABLE role_connector_grants
       ADD CONSTRAINT role_connector_grants_connector_id_fkey
       FOREIGN KEY (connector_id) REFERENCES canonical_connectors(id)`,
    `ALTER TABLE connector_connections
       ADD CONSTRAINT connector_connections_connector_id_fkey
       FOREIGN KEY (connector_id) REFERENCES canonical_connectors(id)`,
    `ALTER TABLE users
       ADD CONSTRAINT users_tenant_role_check
       CHECK (tenant_role IN ('tenant_admin', 'member'))`,
    `ALTER TABLE person_connector_grants
       ADD CONSTRAINT person_connector_grants_connector_id_fkey
       FOREIGN KEY (connector_id) REFERENCES canonical_connectors(id)`,
    `ALTER TABLE canonical_connectors
       ADD CONSTRAINT canonical_connectors_source_check
       CHECK (source IN ('seeded', 'integrations.sh', 'custom'))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_connectors_source_entry
       ON canonical_connectors(source_entry_id)
       WHERE source_entry_id IS NOT NULL`,
    `ALTER TABLE tenant_connector_class_c_secrets
       ADD CONSTRAINT tenant_connector_class_c_secrets_connector_id_fkey
       FOREIGN KEY (connector_id) REFERENCES canonical_connectors(id)`,
    `ALTER TABLE connector_member_subsets
       ADD CONSTRAINT connector_member_subsets_connector_id_fkey
       FOREIGN KEY (connector_id) REFERENCES canonical_connectors(id)`,
  ];

  for (const sql of statements) {
    try {
      await db.exec(sql);
    } catch (error) {
      // 42710 duplicate_object, 42P16 invalid_table_definition (constraint exists
      // under another name from CREATE TABLE CHECK), 42704 undefined_object edge.
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string"
          ? (error as { code: string }).code
          : "";
      if (
        code === "42710" ||
        code === "42P16" ||
        code === "42704" ||
        /already exists/i.test(String(error))
      ) {
        continue;
      }
      throw error;
    }
  }
}
