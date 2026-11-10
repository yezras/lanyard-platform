export type CognitoAuthResult = {
  sub: string;
  email: string;
};

export class CognitoAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, options: { status?: number; code?: string } = {}) {
    super(message);
    this.name = "CognitoAuthError";
    this.status = options.status ?? 401;
    this.code = options.code ?? "NotAuthorizedException";
  }
}

export type CognitoPasswordAuth = {
  authenticate(email: string, password: string): Promise<CognitoAuthResult>;
  register(email: string, password: string): Promise<CognitoAuthResult>;
};
