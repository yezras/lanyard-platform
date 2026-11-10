import { createHmac } from "node:crypto";
import {
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  UsernameExistsException,
  NotAuthorizedException,
  UserNotFoundException,
} from "@aws-sdk/client-cognito-identity-provider";

import {
  CognitoAuthError,
  type CognitoAuthResult,
  type CognitoPasswordAuth,
} from "./cognito-auth.js";

export type AwsCognitoPasswordAuthOptions = {
  userPoolId: string;
  clientId: string;
  region: string;
  clientSecret?: string;
};

function secretHash(
  username: string,
  clientId: string,
  clientSecret: string,
): string {
  return createHmac("sha256", clientSecret)
    .update(username + clientId)
    .digest("base64");
}

function subFromIdToken(idToken: string): string {
  const payload = idToken.split(".")[1];
  if (!payload) {
    throw new CognitoAuthError("Cognito response missing id token");
  }
  const json = Buffer.from(payload, "base64url").toString("utf8");
  const claims = JSON.parse(json) as { sub?: string; email?: string };
  if (!claims.sub) {
    throw new CognitoAuthError("Cognito id token missing sub");
  }
  return claims.sub;
}

export class AwsCognitoPasswordAuth implements CognitoPasswordAuth {
  private readonly client: CognitoIdentityProviderClient;
  private readonly userPoolId: string;
  private readonly clientId: string;
  private readonly clientSecret?: string;

  constructor(options: AwsCognitoPasswordAuthOptions) {
    this.client = new CognitoIdentityProviderClient({ region: options.region });
    this.userPoolId = options.userPoolId;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
  }

  async register(email: string, password: string): Promise<CognitoAuthResult> {
    const username = email.trim().toLowerCase();
    try {
      const created = await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          MessageAction: "SUPPRESS",
          UserAttributes: [
            { Name: "email", Value: username },
            { Name: "email_verified", Value: "true" },
          ],
        }),
      );
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          Password: password,
          Permanent: true,
        }),
      );
      const sub =
        created.User?.Attributes?.find((attr) => attr.Name === "sub")?.Value ??
        created.User?.Username;
      if (!sub) {
        throw new CognitoAuthError("Cognito create user missing sub");
      }
      return { sub, email: username };
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        throw new CognitoAuthError("User already exists", {
          status: 409,
          code: "UsernameExistsException",
        });
      }
      throw error;
    }
  }

  async authenticate(
    email: string,
    password: string,
  ): Promise<CognitoAuthResult> {
    const username = email.trim().toLowerCase();
    const authParameters: Record<string, string> = {
      USERNAME: username,
      PASSWORD: password,
    };
    if (this.clientSecret) {
      authParameters.SECRET_HASH = secretHash(
        username,
        this.clientId,
        this.clientSecret,
      );
    }

    try {
      const result = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.clientId,
          AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
          AuthParameters: authParameters,
        }),
      );
      const idToken = result.AuthenticationResult?.IdToken;
      if (!idToken) {
        throw new CognitoAuthError("Cognito login did not return tokens");
      }
      return { sub: subFromIdToken(idToken), email: username };
    } catch (error) {
      if (
        error instanceof NotAuthorizedException ||
        error instanceof UserNotFoundException
      ) {
        throw new CognitoAuthError("Incorrect username or password");
      }
      throw error;
    }
  }
}

export function loadCognitoPasswordAuth(
  env: NodeJS.ProcessEnv = process.env,
): CognitoPasswordAuth | undefined {
  const userPoolId = env.COGNITO_USER_POOL_ID?.trim();
  const clientId = env.COGNITO_CLIENT_ID?.trim();
  const region = env.COGNITO_REGION?.trim();
  if (!userPoolId || !clientId || !region) {
    return undefined;
  }
  return new AwsCognitoPasswordAuth({
    userPoolId,
    clientId,
    region,
    clientSecret: env.COGNITO_CLIENT_SECRET?.trim() || undefined,
  });
}
