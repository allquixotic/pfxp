import { describe, expect, test } from 'bun:test';
import {
  encryptPasswordWithKey,
  parseScrapeResponse,
  PfxpApiClient,
  PfxpApiError,
} from './api';

describe('API helpers', () => {
  test('encrypts credentials with RSA-OAEP-256', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      false,
      ['encrypt', 'decrypt'],
    );
    const credential = await encryptPasswordWithKey('correct horse', 'key-1', pair.publicKey);
    const ciphertext = Uint8Array.from(atob(credential.ciphertext), (character) => character.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, ciphertext);
    expect(credential.keyId).toBe('key-1');
    expect(new TextDecoder().decode(plaintext)).toBe('correct horse');
  });

  test('submits the credential as decryptable ciphertext without plaintext', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt'],
    );
    const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    let submittedBody = '';
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/crypto/key')) {
        return new Response(JSON.stringify({
          keyId: 'key-2',
          alg: 'RSA-OAEP-256',
          key: publicJwk,
          expiresAt: Date.now() + 60_000,
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      submittedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ status: 'queued', jobId: 'job-1' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    const client = new PfxpApiClient({ baseUrl: 'https://pfxp.test', fetch: fetcher });

    await expect(client.submit('user@example.com', 'correct horse')).resolves.toMatchObject({
      status: 'queued',
    });

    expect(submittedBody).not.toContain('correct horse');
    const payload = JSON.parse(submittedBody) as {
      email: string;
      credential: { keyId: string; ciphertext: string };
      password?: unknown;
    };
    expect(payload).not.toHaveProperty('password');
    expect(payload.credential.keyId).toBe('key-2');
    const ciphertext = Uint8Array.from(
      atob(payload.credential.ciphertext),
      (character) => character.charCodeAt(0),
    );
    const plaintext = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pair.privateKey, ciphertext);
    expect(new TextDecoder().decode(plaintext)).toBe('correct horse');
  });

  test('requires data on ready responses', () => {
    expect(() => parseScrapeResponse({ status: 'ready' })).toThrow(PfxpApiError);
    expect(parseScrapeResponse({
      status: 'ready',
      data: { characters: [], details: [], summary: {} },
    })).toMatchObject({ status: 'ready' });
  });
});
