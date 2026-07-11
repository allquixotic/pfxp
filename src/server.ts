import type { UserData, QueueItem, FetchRequest, FetchResponse, ProgressEvent } from './types';
import { PaizoScraper } from './scraper';
import { canonicalizePaizoEmail } from './account';

// Security: strict Content Security Policy for all responses
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

function jsonWithCsp(body: any, init?: { status?: number; headers?: HeadersInit }) {
  const baseHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    'Content-Security-Policy': CSP,
  };
  const headers = { ...baseHeaders, ...(init?.headers || {}) } as HeadersInit;
  const status = init?.status;
  return new Response(JSON.stringify(body), { status, headers });
}

// Configuration
const REFRESH_COOLDOWN = 5 * 60 * 1000; // 5 minutes
const LOGIN_BLOCK_DURATION = 2 * 60 * 1000; // 2 minutes  
const SCRAPE_ERROR_DELAY = 5 * 60 * 1000; // 5 minutes

// In-memory storage
const userData = new Map<string, UserData>();
const processingQueue: QueueItem[] = [];
let runningCount = 0;
let globalBlockUntil: number | null = null;

// Progress + SSE subscriptions
const progressByJobId = new Map<string, ProgressEvent>();
const subsByJobId = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>();

function getSubs(jobId: string) {
  let set = subsByJobId.get(jobId);
  if (!set) { set = new Set(); subsByJobId.set(jobId, set); }
  return set;
}

function pushProgress(jobId: string, patch: Partial<ProgressEvent>) {
  const prev = progressByJobId.get(jobId);
  const next: ProgressEvent = {
    jobId,
    status: patch.status || prev?.status || 'processing',
    step: patch.step ?? prev?.step,
    message: patch.message ?? prev?.message,
    currentPage: patch.currentPage ?? prev?.currentPage,
    totalPages: patch.totalPages ?? prev?.totalPages,
    percent: patch.percent ?? prev?.percent,
    queuePosition: patch.queuePosition ?? prev?.queuePosition,
    ts: Date.now(),
  };
  progressByJobId.set(jobId, next);
  const subs = subsByJobId.get(jobId);
  if (subs && subs.size > 0) {
    const enc = new TextEncoder();
    const data = enc.encode(`event: progress\n` + `data: ${JSON.stringify(next)}\n\n`);
    subs.forEach((controller) => {
      try { controller.enqueue(data); } catch {}
    });
  }
}

// Ephemeral RSA-OAEP key management for credential encryption
const KEY_ROTATE_MS = 15 * 60 * 1000; // rotate every 15 minutes
const KEY_GRACE_MS = 5 * 60 * 1000; // keep old keys briefly for in-flight requests

type KeyEntry = {
  id: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  createdAt: number;
  expiresAt: number;
};

const keyStore = new Map<string, KeyEntry>();
let currentKeyId: string | null = null;

async function generateNewKeyPair(): Promise<KeyEntry> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt']
  );
  const id = crypto.randomUUID();
  const now = Date.now();
  return {
    id,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    createdAt: now,
    expiresAt: now + KEY_ROTATE_MS,
  };
}

async function rotateKeys() {
  const entry = await generateNewKeyPair();
  keyStore.set(entry.id, entry);
  currentKeyId = entry.id;
  // prune expired keys beyond grace period
  const now = Date.now();
  for (const [id, ke] of keyStore) {
    if (ke.expiresAt + KEY_GRACE_MS < now && id !== currentKeyId) {
      keyStore.delete(id);
    }
  }
}

async function getCurrentPublicJwk() {
  if (!currentKeyId) {
    await rotateKeys();
  }
  const entry = keyStore.get(currentKeyId!);
  if (!entry) throw new Error('Key unavailable');
  const jwk = await crypto.subtle.exportKey('jwk', entry.publicKey);
  return { keyId: entry.id, jwk, expiresAt: entry.expiresAt };
}

function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const buf = Buffer.from(b64, 'base64');
  const bytes = new Uint8Array(new ArrayBuffer(buf.length));
  bytes.set(buf);
  return bytes.buffer;
}

async function decryptCredential(payload: { keyId: string; ciphertext: string }): Promise<string> {
  const entry = keyStore.get(payload.keyId);
  if (!entry) throw new Error('Invalid keyId');
  const ciphertext = b64ToArrayBuffer(payload.ciphertext);
  const pt = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, entry.privateKey, ciphertext);
  return new TextDecoder().decode(pt);
}

// Initialize scraper  
const scraper = new PaizoScraper();

// kick off rotation timer with proper error handling
rotateKeys().catch((e) => {
  console.error('Initial key rotation failed:', e?.stack || e);
});

setInterval(() => {
  rotateKeys().catch((e) => console.error('Key rotation failed:', e?.stack || e));
}, KEY_ROTATE_MS);

async function processQueue() {
  if (processingQueue.length === 0) {
    return;
  }

  // Respect global block for new dispatches
  if (globalBlockUntil && Date.now() < globalBlockUntil) {
    setTimeout(processQueue, globalBlockUntil - Date.now());
    return;
  }

  const limit = scraper.getConcurrencyLimit();
  while (runningCount < limit && processingQueue.length > 0) {
    const item = processingQueue.shift()!;
    startItem(item).catch((e) => console.error(e?.stack || e));
  }
}

async function startItem(item: QueueItem) {
  runningCount++;
  const emailLower = canonicalizePaizoEmail(item.email);
  // Update progress: now processing
  pushProgress(item.jobId, { jobId: item.jobId, status: 'processing', message: 'Starting…' });

  try {
    // Update user status
    const user = userData.get(emailLower) || {
      data: null,
      lastFetch: 0,
      status: 'idle',
      errorCount: 0
    };

    user.status = 'processing';
    userData.set(emailLower, user);

    // Scrape data (scraper constructed headless by default for API path)
    const data = await scraper.scrapeData(item.email, item.password, {
      onProgress: (p) => {
        // Map scraper progress to SSE progress
        const msg = p.message || (p.step ? p.step.replace(/[:]/g, ' → ') : 'Processing…');
        let percent: number | undefined;
        if (p.currentPage && p.totalPages && p.totalPages > 0) {
          percent = Math.max(0, Math.min(100, Math.round((p.currentPage / p.totalPages) * 100)));
        }
        pushProgress(item.jobId, { jobId: item.jobId, status: 'processing', step: p.step, message: msg, currentPage: p.currentPage, totalPages: p.totalPages, percent });
      }
    });

    // Update user data
    user.data = data;
    user.lastFetch = Date.now();
    user.status = 'idle';
    user.errorCount = 0;
    userData.set(emailLower, user);
    // Notify ready
    pushProgress(item.jobId, { jobId: item.jobId, status: 'ready', message: 'Done' });
  } catch (error: any) {
    // Log full error to stderr without hiding details
    console.error(error?.stack || error);
    const user = userData.get(emailLower) || {
      data: null,
      lastFetch: 0,
      status: 'idle',
      errorCount: 0
    };

    if (error && (error as any).message === 'Login failed - invalid credentials') {
      // Block this email for 2 minutes
      user.status = 'blocked';
      user.blockedUntil = Date.now() + LOGIN_BLOCK_DURATION;
      user.errorCount++;
      pushProgress(item.jobId, { jobId: item.jobId, status: 'blocked', message: 'Login failed — temporarily blocked' });
    } else {
      // Scraping error - implement global delay
      globalBlockUntil = Date.now() + SCRAPE_ERROR_DELAY;
      user.status = 'error';
      user.errorCount++;
      pushProgress(item.jobId, { jobId: item.jobId, status: 'error', message: 'Error while scraping' });
    }

    userData.set(emailLower, user);
  } finally {
    runningCount--;
    // Attempt to fill remaining capacity immediately
    setTimeout(processQueue, 0);
  }
}

async function serveStatic(url: URL): Promise<Response | null> {
  // Map "/" to public/index.html
  const publicRoot = new URL('../public/', import.meta.url);
  let pathname = url.pathname;
  if (pathname === '/') pathname = '/index.html';
  try {
    const fileUrl = new URL(`.${pathname}`, publicRoot);
    const file = Bun.file(fileUrl);
    if (await file.exists()) {
      const headers: HeadersInit = {};
      // Long-term cache only for fingerprinted assets like app.[hash].js|css
      if (pathname.startsWith('/assets/')) {
        const isHashed = /\.[0-9a-fA-F]{8,}\.(?:js|css)$/.test(pathname);
        headers['Cache-Control'] = isHashed
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate';
      } else if (pathname.endsWith('.html')) {
        headers['Cache-Control'] = 'no-cache';
      }
      headers['Content-Security-Policy'] = CSP;
      return new Response(file, { headers });
    }
  } catch (_) {
    // ignore
  }
  return null;
}

// Start the server
const server = Bun.serve({
  port: 3000,
  
  async fetch(req) {
    const url = new URL(req.url);

    // SSE progress events
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const jobId = url.searchParams.get('jobId') || '';
      if (!jobId) return new Response('Missing jobId', { status: 400, headers: { 'Content-Security-Policy': CSP } });

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          getSubs(jobId).add(controller);
          // Immediately send last known progress
          const last = progressByJobId.get(jobId);
          if (last) {
            controller.enqueue(enc.encode(`event: progress\n` + `data: ${JSON.stringify(last)}\n\n`));
          }
          // Heartbeat to keep connection alive
          (controller as any)._hb = setInterval(() => {
            try { controller.enqueue(enc.encode(': keep-alive\n\n')); } catch {}
          }, 15000);
        },
        cancel() {
          const set = subsByJobId.get(jobId);
          if (set) {
            // Remove all controllers that are closed (this one auto-removed by GC)
          }
        }
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Content-Security-Policy': CSP,
        }
      });
    }

    // Static UI
    if (req.method === 'GET') {
      // Crypto key endpoint
      if (url.pathname === '/api/crypto/key') {
        try {
          const { keyId, jwk, expiresAt } = await getCurrentPublicJwk();
          return jsonWithCsp({ keyId, alg: 'RSA-OAEP-256', key: jwk, expiresAt });
        } catch (err) {
          return jsonWithCsp({ error: 'Key unavailable' }, { status: 503 });
        }
      }
      const staticResp = await serveStatic(url);
      if (staticResp) return staticResp;
    }
    
    if (url.pathname === '/api/fetch' && req.method === 'POST') {
      try {
        const body = await req.json() as FetchRequest;
        const emailLower = canonicalizePaizoEmail(body.email);
        if (!emailLower) return jsonWithCsp({ error: 'Missing email' }, { status: 400 });

        // Resolve password: prefer encrypted credential
        let password: string | undefined;
        if (body.credential?.keyId && body.credential?.ciphertext) {
          try {
            password = await decryptCredential({ keyId: body.credential.keyId, ciphertext: body.credential.ciphertext });
          } catch (e) {
            return jsonWithCsp({ error: 'Unable to decrypt credentials' }, { status: 400 });
          }
        } else {
          password = body.password;
        }
        if (!password) {
          return jsonWithCsp({ error: 'Missing credentials' }, { status: 400 });
        }
        
        // Get or create user data
        let user = userData.get(emailLower);
        if (!user) {
          user = {
            data: null,
            lastFetch: 0,
            status: 'idle',
            errorCount: 0
          };
          userData.set(emailLower, user);
        }
        
        // Check if blocked
        if (user.blockedUntil && Date.now() < user.blockedUntil) {
          const response: FetchResponse = {
            status: 'blocked',
            message: 'Too many failed login attempts. Please try again later.',
            retryAfter: user.blockedUntil
          };
          return jsonWithCsp(response, { status: 403 });
        }
        
        // Check if already processing
        if (user.status === 'processing') {
          const response: FetchResponse = {
            status: 'processing',
            message: 'Your request is being processed. Please check back later.'
          };
          return jsonWithCsp(response);
        }
        
        // Check refresh cooldown
        if (user.data && user.lastFetch + REFRESH_COOLDOWN > Date.now()) {
          const response: FetchResponse = {
            status: 'ready',
            data: user.data
          };
          return jsonWithCsp(response);
        }
        
        // Create a job id per request
        const jobId = crypto.randomUUID();

        // Check if already in queue for this email; if so, just return queued with its jobId not tracked. We allow distinct jobs per request.
        // Add to processing queue
        const queuePosition = processingQueue.length; // position before pushing
        processingQueue.push({
          jobId,
          email: emailLower,
          password,
          queuedAt: Date.now()
        });
        // Initial progress
        pushProgress(jobId, { jobId, status: 'queued', queuePosition, message: `Queued — ${queuePosition} ahead of you` });
        
        // Start processing if not already running
        processQueue();
        
        const response: FetchResponse = {
          status: 'queued',
          message: 'Your request has been queued for processing.',
          jobId
        };
        return jsonWithCsp(response);
        
      } catch (error) {
        return jsonWithCsp({ error: 'Invalid request' }, { status: 400 });
      }
    }
    
    if (url.pathname === '/api/status' && req.method === 'POST') {
      try {
        const body = await req.json() as { email: string };
        const emailLower = canonicalizePaizoEmail(body.email);
        
        const user = userData.get(emailLower);
        if (!user) {
          const response: FetchResponse = {
            status: 'error',
            message: 'No data found for this email. Please submit a fetch request first.'
          };
          return jsonWithCsp(response, { status: 404 });
        }
        
        // Check various statuses
        if (user.blockedUntil && Date.now() < user.blockedUntil) {
          const response: FetchResponse = {
            status: 'blocked',
            message: 'Account temporarily blocked due to failed login attempts.',
            retryAfter: user.blockedUntil
          };
          return jsonWithCsp(response);
        }
        
        if (user.status === 'processing') {
          const response: FetchResponse = {
            status: 'processing',
            message: 'Your request is being processed.'
          };
          return jsonWithCsp(response);
        }
        
        if (user.data) {
          const response: FetchResponse = {
            status: 'ready',
            data: user.data
          };
          return jsonWithCsp(response);
        }
        
        const response: FetchResponse = {
          status: 'error',
          message: 'An error occurred while fetching your data.'
        };
        return jsonWithCsp(response);
        
      } catch (error) {
        return jsonWithCsp({ error: 'Invalid request' }, { status: 400 });
      }
    }
    
    return new Response('Not Found', { status: 404, headers: { 'Content-Security-Policy': CSP } });
  }
});

// Log server startup immediately
console.log(`Server running at http://localhost:${server.port}`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await scraper.close();
  process.exit(0);
});

// Export the server for testing
export { server };
