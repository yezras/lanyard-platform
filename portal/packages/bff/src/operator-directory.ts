/**
 * Closed operator allowlist for the ops session plane.
 *
 * Production BFF uses `PLATFORM_OPERATOR_EMAILS` (comma-separated). Prisma
 * `PlatformAdmin` is the Start scaffold table and is not queried from BFF.
 */

export type OpsOperator = {
  operatorId: string;
  email: string;
};

export interface OperatorDirectory {
  lookupByEmail(email: string): Promise<OpsOperator | null>;
}

export function normalizeOperatorEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parsePlatformOperatorEmails(
  raw: string | undefined,
): OpsOperator[] {
  if (!raw?.trim()) {
    return [];
  }
  const seen = new Set<string>();
  const operators: OpsOperator[] = [];
  for (const part of raw.split(",")) {
    const email = normalizeOperatorEmail(part);
    if (!email || seen.has(email)) {
      continue;
    }
    seen.add(email);
    operators.push({ operatorId: email, email });
  }
  return operators;
}

export class MemoryOperatorDirectory implements OperatorDirectory {
  private readonly byEmail: Map<string, OpsOperator>;

  constructor(operators: readonly OpsOperator[] = []) {
    this.byEmail = new Map(
      operators.map((op) => {
        const email = normalizeOperatorEmail(op.email);
        return [
          email,
          { operatorId: op.operatorId, email },
        ] as const;
      }),
    );
  }

  async lookupByEmail(email: string): Promise<OpsOperator | null> {
    return this.byEmail.get(normalizeOperatorEmail(email)) ?? null;
  }
}

/**
 * Local-only operator emails when `DEV_TENANT_SLUG` is set and
 * `PLATFORM_OPERATOR_EMAILS` is unset. Production stays fail-closed.
 */
export const LOCAL_DEV_OPERATOR_EMAILS = [
  "ops@lanyard.local",
  "dev@demo.local",
  "agent-dev@mocklab.example.com",
] as const;

export function createEnvOperatorDirectory(
  env: NodeJS.ProcessEnv = process.env,
): MemoryOperatorDirectory {
  const fromEnv = parsePlatformOperatorEmails(env.PLATFORM_OPERATOR_EMAILS);
  if (fromEnv.length > 0) {
    return new MemoryOperatorDirectory(fromEnv);
  }
  if (env.DEV_TENANT_SLUG?.trim()) {
    return new MemoryOperatorDirectory(
      LOCAL_DEV_OPERATOR_EMAILS.map((email) => ({
        operatorId: email,
        email,
      })),
    );
  }
  return new MemoryOperatorDirectory([]);
}
