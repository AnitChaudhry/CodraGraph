import { randomBytes } from 'node:crypto';
import {
  AuthorizeError,
  CallbackError,
  type AuthorizeInput,
  type AuthorizeResult,
  type CallbackInput,
  type SsoProvider,
  type UserClaim,
} from './interface.js';

/**
 * In-process test stub. Lets tests exercise the full SSO flow without
 * a real IdP — register some fake users, "log them in" by passing
 * their subject, and assert on the resulting {@link UserClaim}.
 *
 * Production deployments wire in an OIDC or SAML provider instead.
 */
export class InMemorySsoProvider implements SsoProvider {
  readonly name = 'in-memory';
  readonly type = 'stub' as const;

  private readonly users = new Map<string, UserClaim>();
  private readonly states = new Set<string>();

  registerUser(claim: UserClaim): void {
    this.users.set(claim.subject, claim);
  }

  async authorize(input: AuthorizeInput): Promise<AuthorizeResult> {
    if (!input.redirectUri) {
      throw new AuthorizeError('redirectUri is required');
    }
    const state = randomBytes(16).toString('hex');
    this.states.add(state);
    const url = new URL('urn:codragraph-org:in-memory-idp/authorize');
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('state', state);
    if (input.callerState) {
      url.searchParams.set('caller_state', input.callerState);
    }
    return { redirectUrl: url.toString(), state };
  }

  async callback(input: CallbackInput): Promise<UserClaim> {
    const state = input.params['state'];
    if (state !== input.expectedState) {
      throw new CallbackError('state mismatch (CSRF defense)');
    }
    if (!this.states.delete(state)) {
      throw new CallbackError('state already consumed or unknown');
    }
    const subject = input.params['subject'];
    if (!subject) {
      throw new CallbackError('missing subject in callback params');
    }
    const claim = this.users.get(subject);
    if (!claim) {
      throw new CallbackError(`unknown subject ${subject}`);
    }
    return claim;
  }
}
