import { parsePfxpDocument, type PfxpDocument } from '../domain';

/** Lifecycle states returned by the PFXP HTTP API. */
export type ScrapeStatus = 'queued' | 'processing' | 'ready' | 'error' | 'blocked';

/** Client-side RSA-OAEP credential payload accepted by `/api/fetch`. */
export interface EncryptedCredential {
  keyId: string;
  ciphertext: string;
}

/** Typed response returned by fetch and status requests. */
export interface ScrapeResponse {
  status: ScrapeStatus;
  data?: PfxpDocument;
  message?: string;
  retryAfter?: number;
  jobId?: string;
}

/** Progress payload delivered by the server's SSE endpoint. */
export interface ScrapeProgressEvent {
  jobId: string;
  status: ScrapeStatus;
  step?: string;
  message?: string;
  currentPage?: number;
  totalPages?: number;
  percent?: number;
  queuePosition?: number;
  ts: number;
}

/** Minimal API surface consumed by the scrape controller. */
export interface ScrapeApi {
  submit(email: string, password: string, signal?: AbortSignal): Promise<ScrapeResponse>;
  status(email: string, signal?: AbortSignal): Promise<ScrapeResponse>;
  eventsUrl(jobId: string): string;
}

/** HTTP or protocol error raised while talking to the PFXP API. */
export class PfxpApiError extends Error {
  readonly statusCode: number | null;
  readonly body: unknown;

  constructor(message: string, statusCode: number | null = null, body?: unknown) {
    super(message);
    this.name = 'PfxpApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

interface CryptoKeyResponse {
  keyId: string;
  alg: 'RSA-OAEP-256';
  key: JsonWebKey;
  expiresAt: number;
}

interface CachedKey {
  keyId: string;
  expiresAt: number;
  publicKey: CryptoKey;
}

const statuses = new Set<ScrapeStatus>([
  'queued',
  'processing',
  'ready',
  'error',
  'blocked',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new PfxpApiError(`Invalid ${name} in API response`);
  return value;
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PfxpApiError(`Invalid ${name} in API response`);
  }
  return value;
}

/** Validate an unknown fetch/status response and detach its document data. */
export function parseScrapeResponse(value: unknown): ScrapeResponse {
  if (!isRecord(value) || typeof value.status !== 'string' || !statuses.has(value.status as ScrapeStatus)) {
    throw new PfxpApiError('Invalid status in API response', null, value);
  }

  const response: ScrapeResponse = {
    status: value.status as ScrapeStatus,
  };
  const message = optionalString(value.message, 'message');
  const jobId = optionalString(value.jobId, 'jobId');
  const retryAfter = optionalNumber(value.retryAfter, 'retryAfter');
  if (message !== undefined) response.message = message;
  if (jobId !== undefined) response.jobId = jobId;
  if (retryAfter !== undefined) response.retryAfter = retryAfter;
  if (value.data !== undefined) response.data = parsePfxpDocument(value.data);
  if (response.status === 'ready' && !response.data) {
    throw new PfxpApiError('Ready API response did not include data', null, value);
  }
  return response;
}

/** Validate an unknown SSE progress payload. */
export function parseProgressEvent(value: unknown): ScrapeProgressEvent {
  if (!isRecord(value)) throw new PfxpApiError('Invalid progress event', null, value);
  if (typeof value.jobId !== 'string' || !value.jobId) {
    throw new PfxpApiError('Invalid jobId in progress event', null, value);
  }
  if (typeof value.status !== 'string' || !statuses.has(value.status as ScrapeStatus)) {
    throw new PfxpApiError('Invalid status in progress event', null, value);
  }
  if (typeof value.ts !== 'number' || !Number.isFinite(value.ts)) {
    throw new PfxpApiError('Invalid timestamp in progress event', null, value);
  }

  const event: ScrapeProgressEvent = {
    jobId: value.jobId,
    status: value.status as ScrapeStatus,
    ts: value.ts,
  };
  const stringFields = ['step', 'message'] as const;
  for (const field of stringFields) {
    const parsed = optionalString(value[field], field);
    if (parsed !== undefined) event[field] = parsed;
  }
  const numberFields = ['currentPage', 'totalPages', 'percent', 'queuePosition'] as const;
  for (const field of numberFields) {
    const parsed = optionalNumber(value[field], field);
    if (parsed !== undefined) event[field] = parsed;
  }
  return event;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Encrypt a password for a server-provided RSA-OAEP public key. */
export async function encryptPasswordWithKey(
  password: string,
  keyId: string,
  publicKey: CryptoKey,
): Promise<EncryptedCredential> {
  const plaintext = new TextEncoder().encode(password);
  password = '';
  try {
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      plaintext,
    );
    return { keyId, ciphertext: arrayBufferToBase64(ciphertext) };
  } finally {
    plaintext.fill(0);
  }
}

/** Fetch-based, encrypted client for the existing PFXP backend. */
export class PfxpApiClient implements ScrapeApi {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private keyCache: CachedKey | null = null;

  constructor(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/$/, '');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  eventsUrl(jobId: string): string {
    return this.url(`/api/events?jobId=${encodeURIComponent(jobId)}`);
  }

  async encryptedCredential(password: string, signal?: AbortSignal): Promise<EncryptedCredential> {
    const key = await this.publicKey(signal);
    const encryption = encryptPasswordWithKey(password, key.keyId, key.publicKey);
    password = '';
    return encryption;
  }

  async submit(email: string, password: string, signal?: AbortSignal): Promise<ScrapeResponse> {
    const encryptedCredential = this.encryptedCredential(password, signal);
    password = '';
    const credential = await encryptedCredential;
    return this.post('/api/fetch', { email, credential }, signal);
  }

  async status(email: string, signal?: AbortSignal): Promise<ScrapeResponse> {
    return this.post('/api/status', { email }, signal);
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async publicKey(signal?: AbortSignal): Promise<CachedKey> {
    const now = Date.now();
    if (this.keyCache && this.keyCache.expiresAt - now > 10_000) return this.keyCache;
    const response = await this.fetcher(this.url('/api/crypto/key'), { signal });
    const body = await this.readJson(response);
    if (!response.ok) throw this.httpError(response, body, 'Unable to fetch encryption key');
    if (
      !isRecord(body)
      || typeof body.keyId !== 'string'
      || body.alg !== 'RSA-OAEP-256'
      || !isRecord(body.key)
      || typeof body.expiresAt !== 'number'
      || !Number.isFinite(body.expiresAt)
    ) {
      throw new PfxpApiError('Invalid encryption key response', response.status, body);
    }

    const parsed = body as unknown as CryptoKeyResponse;
    const publicKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      parsed.key,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt'],
    );
    this.keyCache = { keyId: parsed.keyId, expiresAt: parsed.expiresAt, publicKey };
    return this.keyCache;
  }

  private async post(
    path: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<ScrapeResponse> {
    const response = await this.fetcher(this.url(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
    const body = await this.readJson(response);
    try {
      return parseScrapeResponse(body);
    } catch (error) {
      if (!response.ok) throw this.httpError(response, body, 'PFXP request failed');
      throw error;
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json() as unknown;
    } catch {
      throw new PfxpApiError('Server returned a non-JSON response', response.status);
    }
  }

  private httpError(response: Response, body: unknown, fallback: string): PfxpApiError {
    const message = isRecord(body)
      ? (typeof body.error === 'string' ? body.error : typeof body.message === 'string' ? body.message : fallback)
      : fallback;
    return new PfxpApiError(message, response.status, body);
  }
}
