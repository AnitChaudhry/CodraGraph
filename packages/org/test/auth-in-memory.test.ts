import { describe, it, expect, beforeEach } from 'vitest';
import { InMemorySsoProvider } from '../src/auth/in-memory.js';
import { CallbackError } from '../src/auth/interface.js';

describe('auth/in-memory', () => {
  let provider: InMemorySsoProvider;

  beforeEach(() => {
    provider = new InMemorySsoProvider();
  });

  it('authorize returns a redirect URL containing the redirect_uri and state', async () => {
    const r = await provider.authorize({ redirectUri: 'https://app.example/callback' });
    expect(r.redirectUrl).toContain('redirect_uri=https%3A%2F%2Fapp.example%2Fcallback');
    expect(r.state).toMatch(/^[0-9a-f]{32}$/);
  });

  it('callback returns the registered claim for a known subject', async () => {
    provider.registerUser({
      subject: 'u-1',
      email: 'alice@example.com',
      emailVerified: true,
      name: 'Alice',
    });
    const auth = await provider.authorize({ redirectUri: 'https://app/cb' });
    const claim = await provider.callback({
      params: { state: auth.state, subject: 'u-1' },
      expectedState: auth.state,
    });
    expect(claim.email).toBe('alice@example.com');
  });

  it('callback rejects on state mismatch (CSRF)', async () => {
    provider.registerUser({ subject: 'u-1', email: 'a@b', emailVerified: true });
    const auth = await provider.authorize({ redirectUri: 'https://app/cb' });
    await expect(
      provider.callback({
        params: { state: 'tampered', subject: 'u-1' },
        expectedState: auth.state,
      }),
    ).rejects.toBeInstanceOf(CallbackError);
  });

  it('callback rejects state replay', async () => {
    provider.registerUser({ subject: 'u-1', email: 'a@b', emailVerified: true });
    const auth = await provider.authorize({ redirectUri: 'https://app/cb' });
    await provider.callback({
      params: { state: auth.state, subject: 'u-1' },
      expectedState: auth.state,
    });
    await expect(
      provider.callback({
        params: { state: auth.state, subject: 'u-1' },
        expectedState: auth.state,
      }),
    ).rejects.toBeInstanceOf(CallbackError);
  });

  it('callback rejects unknown subjects', async () => {
    const auth = await provider.authorize({ redirectUri: 'https://app/cb' });
    await expect(
      provider.callback({
        params: { state: auth.state, subject: 'unknown' },
        expectedState: auth.state,
      }),
    ).rejects.toBeInstanceOf(CallbackError);
  });
});
