import { randomUUID } from "node:crypto";

import {
  CognitoAuthError,
  type CognitoAuthResult,
  type CognitoPasswordAuth,
} from "./cognito-auth.js";

/** In-memory Cognito stand-in for BFF tests. */
export class FakeCognitoPasswordAuth implements CognitoPasswordAuth {
  private readonly users = new Map<string, { password: string; sub: string }>();

  async register(email: string, password: string): Promise<CognitoAuthResult> {
    const normalized = email.trim().toLowerCase();
    if (this.users.has(normalized)) {
      throw new CognitoAuthError("User already exists", {
        status: 409,
        code: "UsernameExistsException",
      });
    }
    const sub = randomUUID();
    this.users.set(normalized, { password, sub });
    return { sub, email: normalized };
  }

  async authenticate(
    email: string,
    password: string,
  ): Promise<CognitoAuthResult> {
    const normalized = email.trim().toLowerCase();
    const row = this.users.get(normalized);
    if (!row || row.password !== password) {
      throw new CognitoAuthError("Incorrect username or password");
    }
    return { sub: row.sub, email: normalized };
  }
}
