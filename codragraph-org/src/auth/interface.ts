/**
 * Provider-agnostic SSO contract. Concrete providers — OIDC, SAML,
 * a test stub — implement this. The codragraph server picks one based
 * on its config and never imports a concrete provider directly.
 */
export interface SsoProvider {
  readonly name: string;
  readonly type: 'oidc' | 'saml' | 'stub';

  /**
   * Begin an authorization flow. Returns the URL the user agent should
   * be redirected to and an opaque `state` the server must round-trip
   * back to {@link callback} for CSRF defense.
   */
  authorize(input: AuthorizeInput): Promise<AuthorizeResult>;

  /**
   * Complete the flow. Called from the redirect URI handler. On
   * success returns a {@link UserClaim} the server uses to look up or
   * create the {@link User} record.
   */
  callback(input: CallbackInput): Promise<UserClaim>;
}

export interface AuthorizeInput {
  /** Where to redirect after the IdP completes the flow. */
  redirectUri: string;
  /** Optional caller-supplied state to round-trip. */
  callerState?: string;
}

export interface AuthorizeResult {
  redirectUrl: string;
  state: string;
}

export interface CallbackInput {
  /** Raw query string or POST body from the IdP redirect. */
  params: Record<string, string>;
  /** The state value the server stored when {@link authorize} was called. */
  expectedState: string;
}

export interface UserClaim {
  /** Stable id from the IdP (`sub` for OIDC, `NameID` for SAML). */
  subject: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /** Provider-specific extras — do not depend on shape. */
  raw?: unknown;
}

export class AuthorizeError extends Error {
  readonly kind = 'AuthorizeError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizeError';
  }
}

export class CallbackError extends Error {
  readonly kind = 'CallbackError' as const;
  constructor(message: string) {
    super(message);
    this.name = 'CallbackError';
  }
}
