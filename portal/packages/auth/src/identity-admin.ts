import { randomBytes, randomUUID } from "node:crypto";
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";

import { ConflictError } from "@lanyard/shared";

export type IdentityUser = {
  /** Cognito `sub` — stored on Prisma `User.authUserId`. */
  sub: string;
  email: string;
};

function cognitoConfig(env: NodeJS.ProcessEnv = process.env) {
  const userPoolId = env.COGNITO_USER_POOL_ID?.trim();
  const region = env.COGNITO_REGION?.trim();
  if (!userPoolId || !region) return null;
  return { userPoolId, region };
}

function client(region: string): CognitoIdentityProviderClient {
  return new CognitoIdentityProviderClient({ region });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function subFromCreated(
  created: {
    User?: { Attributes?: Array<{ Name?: string; Value?: string }> };
  },
  email: string,
): string {
  const sub = created.User?.Attributes?.find((attr) => attr.Name === "sub")
    ?.Value;
  // Prisma `User.authUserId` is `@db.Uuid`. Cognito username is often the email;
  // never store that in `authUserId`.
  if (!sub || !UUID_RE.test(sub)) {
    throw new ConflictError(`Cognito create user missing sub for ${email}`);
  }
  return sub;
}

/**
 * Creates a Cognito user for product-db invites. Tenant self-signup still goes
 * through the BFF (`packages/bff/src/cognito-aws.ts`).
 *
 * When Cognito env is unset (local without a pool), returns a generated UUID so
 * Prisma `authUserId` stays valid. That user cannot sign in through the BFF.
 */
export async function createIdentityUser(email: string): Promise<IdentityUser> {
  const username = email.trim().toLowerCase();
  const config = cognitoConfig();
  if (!config) {
    return { sub: randomUUID(), email: username };
  }

  const cognito = client(config.region);
  try {
    const created = await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: config.userPoolId,
        Username: username,
        MessageAction: "SUPPRESS",
        UserAttributes: [
          { Name: "email", Value: username },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
    const password = `Tmp!${randomBytes(18).toString("base64url")}`;
    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: config.userPoolId,
        Username: username,
        Password: password,
        Permanent: true,
      }),
    );
    return { sub: subFromCreated(created, username), email: username };
  } catch (error) {
    if (error instanceof UsernameExistsException) {
      throw new ConflictError("A directory user already has that email");
    }
    throw error;
  }
}

export async function updateIdentityUserEmail(
  currentEmail: string,
  nextEmail: string,
): Promise<void> {
  const username = currentEmail.trim().toLowerCase();
  const email = nextEmail.trim().toLowerCase();
  if (username === email) return;
  const config = cognitoConfig();
  if (!config) return;

  const cognito = client(config.region);
  try {
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: config.userPoolId,
        Username: username,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
      }),
    );
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      throw new ConflictError("Unable to update this user email");
    }
    throw error;
  }
}

export async function deleteIdentityUser(email: string): Promise<void> {
  const username = email.trim().toLowerCase();
  const config = cognitoConfig();
  if (!config) return;

  const cognito = client(config.region);
  try {
    await cognito.send(
      new AdminDeleteUserCommand({
        UserPoolId: config.userPoolId,
        Username: username,
      }),
    );
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      return;
    }
    throw error;
  }
}
