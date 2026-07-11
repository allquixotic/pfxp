import type { PfxpDocument } from '../domain';
import {
  parseProgressEvent,
  type ScrapeApi,
  type ScrapeProgressEvent,
  type ScrapeResponse,
  type ScrapeStatus,
} from './api';

/** Transport that produced a scrape lifecycle update. */
export type ScrapeUpdateSource = 'submit' | 'sse' | 'poll';

/** Observable scrape state used by progress UI. */
export interface ScrapeState {
  status: ScrapeStatus;
  source: ScrapeUpdateSource;
  message?: string;
  retryAfter?: number;
  jobId?: string;
  data?: PfxpDocument;
  progress?: ScrapeProgressEvent;
}

/** A terminal scrape result. */
export type ScrapeResult =
  | (ScrapeState & { status: 'ready'; data: PfxpDocument })
  | (ScrapeState & { status: 'error' | 'blocked' });

/** Listener notified whenever the scrape lifecycle changes. */
export type ScrapeListener = (state: ScrapeState) => void;

/** EventSource subset used by the controller and its tests. */
export interface EventSourceLike {
  onerror: ((event: Event) => unknown) | null;
  addEventListener(type: 'progress', listener: (event: MessageEvent<string>) => unknown): void;
  close(): void;
}

/** Options controlling SSE and polling behavior. */
export interface ScrapeControllerOptions {
  pollIntervalMs?: number;
  maxPollingErrors?: number;
  sseSilenceTimeoutMs?: number;
  queuedStatusGraceMs?: number;
  eventSourceFactory?: ((url: string) => EventSourceLike) | null;
}

interface ActiveRun {
  token: symbol;
  email: string;
  abortController: AbortController;
  eventSource: EventSourceLike | null;
  pollTimer: ReturnType<typeof setTimeout> | null;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  pollingErrors: number;
  queuedAt: number | null;
  observedProcessing: boolean;
  resolvingSseTerminal: boolean;
  settled: boolean;
  resolve: (result: ScrapeResult) => void;
  reject: (reason: unknown) => void;
  removeExternalAbort: (() => void) | null;
}

const terminalStatuses = new Set<ScrapeStatus>(['ready', 'error', 'blocked']);

function abortError(): Error {
  const error = new Error('Scrape cancelled');
  error.name = 'AbortError';
  return error;
}

function defaultEventSourceFactory(): ((url: string) => EventSourceLike) | null {
  return typeof globalThis.EventSource === 'function'
    ? (url) => new globalThis.EventSource(url) as EventSourceLike
    : null;
}

/** Coordinate an encrypted scrape request with SSE progress and polling fallback. */
export class ScrapeController {
  private readonly api: ScrapeApi;
  private readonly pollIntervalMs: number;
  private readonly maxPollingErrors: number;
  private readonly sseSilenceTimeoutMs: number;
  private readonly queuedStatusGraceMs: number;
  private readonly eventSourceFactory: ((url: string) => EventSourceLike) | null;
  private readonly listeners = new Set<ScrapeListener>();
  private active: ActiveRun | null = null;

  constructor(api: ScrapeApi, options: ScrapeControllerOptions = {}) {
    this.api = api;
    this.pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 2_000);
    this.maxPollingErrors = Math.max(1, options.maxPollingErrors ?? 5);
    this.sseSilenceTimeoutMs = Math.max(5_000, options.sseSilenceTimeoutMs ?? 45_000);
    this.queuedStatusGraceMs = Math.max(0, options.queuedStatusGraceMs ?? 5 * 60_000);
    this.eventSourceFactory = options.eventSourceFactory === undefined
      ? defaultEventSourceFactory()
      : options.eventSourceFactory;
  }

  /** Subscribe to lifecycle updates; returns an unsubscribe callback. */
  subscribe(listener: ScrapeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Start a scrape, cancelling any previous run owned by this controller. */
  start(email: string, password: string, signal?: AbortSignal): Promise<ScrapeResult> {
    this.stop();
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise<ScrapeResult>((resolve, reject) => {
      const active: ActiveRun = {
        token: Symbol('scrape-run'),
        email,
        abortController: new AbortController(),
        eventSource: null,
        pollTimer: null,
        silenceTimer: null,
        pollingErrors: 0,
        queuedAt: null,
        observedProcessing: false,
        resolvingSseTerminal: false,
        settled: false,
        resolve,
        reject,
        removeExternalAbort: null,
      };
      if (signal) {
        const cancel = () => this.cancel(active);
        signal.addEventListener('abort', cancel, { once: true });
        active.removeExternalAbort = () => signal.removeEventListener('abort', cancel);
      }
      this.active = active;
      void this.submit(active, password);
    });
  }

  /** Cancel the current scrape and close all active transports. */
  stop(): void {
    if (this.active) this.cancel(this.active);
  }

  private async submit(active: ActiveRun, password: string): Promise<void> {
    try {
      let submission!: Promise<ScrapeResponse>;
      try {
        submission = this.api.submit(
          active.email,
          password,
          active.abortController.signal,
        );
      } finally {
        password = '';
      }
      const response = await submission;
      if (!this.isCurrent(active)) return;
      const state = this.fromResponse(response, 'submit');
      if (response.status === 'queued') active.queuedAt = Date.now();
      if (response.status === 'processing') active.observedProcessing = true;
      this.emit(state);
      if (this.finishIfTerminal(active, state)) return;
      if (response.jobId && this.eventSourceFactory) this.openEventSource(active, response.jobId);
      else this.startPolling(active, 0);
    } catch (error) {
      if (!this.isCurrent(active)) return;
      this.fail(active, error);
    }
  }

  private openEventSource(active: ActiveRun, jobId: string): void {
    if (!this.isCurrent(active) || !this.eventSourceFactory) return;
    try {
      const source = this.eventSourceFactory(this.api.eventsUrl(jobId));
      active.eventSource = source;
      this.armSilenceFallback(active);
      source.addEventListener('progress', (message) => {
        if (!this.isCurrent(active)) return;
        this.armSilenceFallback(active);
        let progress: ScrapeProgressEvent;
        try {
          progress = parseProgressEvent(JSON.parse(message.data) as unknown);
        } catch {
          this.fallbackToPolling(active);
          return;
        }
        if (progress.jobId !== jobId) return;
        if (progress.status === 'processing') active.observedProcessing = true;
        const state: ScrapeState = {
          status: progress.status,
          source: 'sse',
          jobId,
          progress,
        };
        if (progress.message !== undefined) state.message = progress.message;
        this.emit(state);
        if (terminalStatuses.has(progress.status)) {
          if (active.resolvingSseTerminal) return;
          active.resolvingSseTerminal = true;
          this.closeEventSource(active);
          void this.resolveSseTerminal(active, state);
        }
      });
      source.onerror = () => this.fallbackToPolling(active);
    } catch {
      this.fallbackToPolling(active);
    }
  }

  private async resolveSseTerminal(active: ActiveRun, sseState: ScrapeState): Promise<void> {
    if (!this.isCurrent(active)) return;
    // Error and blocked SSE events describe this exact job. The legacy status
    // endpoint is keyed only by email and may still expose data from an older
    // successful run, so never let it overwrite a terminal failure.
    if (sseState.status === 'error' || sseState.status === 'blocked') {
      this.finish(active, sseState as ScrapeResult);
      return;
    }
    try {
      const response = await this.api.status(active.email, active.abortController.signal);
      if (!this.isCurrent(active)) return;
      active.resolvingSseTerminal = false;
      const state = this.fromResponse(response, 'poll');
      this.emit(state);
      if (!this.finishIfTerminal(active, state)) this.startPolling(active, this.pollIntervalMs);
    } catch (error) {
      if (!this.isCurrent(active)) return;
      if ((error as { name?: unknown })?.name !== 'AbortError') {
        active.resolvingSseTerminal = false;
        this.startPolling(active, this.pollIntervalMs);
      }
    }
  }

  private fallbackToPolling(active: ActiveRun): void {
    if (!this.isCurrent(active)) return;
    this.closeEventSource(active);
    this.startPolling(active, 0);
  }

  private startPolling(active: ActiveRun, delay: number): void {
    if (!this.isCurrent(active)) return;
    if (active.pollTimer) clearTimeout(active.pollTimer);
    active.pollTimer = setTimeout(() => {
      active.pollTimer = null;
      void this.poll(active);
    }, delay);
  }

  private async poll(active: ActiveRun): Promise<void> {
    if (!this.isCurrent(active)) return;
    try {
      const response = await this.api.status(active.email, active.abortController.signal);
      if (!this.isCurrent(active)) return;
      active.pollingErrors = 0;
      if (response.status === 'processing') active.observedProcessing = true;
      if (this.isQueuedStatusRace(active, response)) {
        this.emit({
          status: 'queued',
          source: 'poll',
          jobId: response.jobId,
          message: 'Waiting for an available browser slot…',
        });
        this.startPolling(active, this.pollIntervalMs);
        return;
      }
      const state = this.fromResponse(response, 'poll');
      this.emit(state);
      if (!this.finishIfTerminal(active, state)) this.startPolling(active, this.pollIntervalMs);
    } catch (error) {
      if (!this.isCurrent(active)) return;
      if ((error as { name?: unknown })?.name === 'AbortError') {
        this.cancel(active);
        return;
      }
      active.pollingErrors += 1;
      if (active.pollingErrors >= this.maxPollingErrors) {
        this.fail(active, error);
        return;
      }
      this.startPolling(active, this.pollIntervalMs * Math.min(active.pollingErrors + 1, 4));
    }
  }

  private fromResponse(response: ScrapeResponse, source: ScrapeUpdateSource): ScrapeState {
    const state: ScrapeState = { status: response.status, source };
    if (response.message !== undefined) state.message = response.message;
    if (response.retryAfter !== undefined) state.retryAfter = response.retryAfter;
    if (response.jobId !== undefined) state.jobId = response.jobId;
    if (response.data !== undefined) state.data = response.data;
    return state;
  }

  private isQueuedStatusRace(active: ActiveRun, response: ScrapeResponse): boolean {
    return response.status === 'error'
      && active.queuedAt !== null
      && !active.observedProcessing
      && Date.now() - active.queuedAt < this.queuedStatusGraceMs;
  }

  private finishIfTerminal(active: ActiveRun, state: ScrapeState): boolean {
    if (state.status === 'ready' && state.data) {
      this.finish(active, state as ScrapeResult);
      return true;
    }
    if (state.status === 'error' || state.status === 'blocked') {
      this.finish(active, state as ScrapeResult);
      return true;
    }
    return false;
  }

  private finish(active: ActiveRun, result: ScrapeResult): void {
    if (!this.isCurrent(active)) return;
    this.cleanup(active);
    active.settled = true;
    this.active = null;
    active.resolve(result);
  }

  private fail(active: ActiveRun, error: unknown): void {
    if (!this.isCurrent(active)) return;
    this.cleanup(active);
    active.settled = true;
    this.active = null;
    active.reject(error);
  }

  private cancel(active: ActiveRun): void {
    if (!this.isCurrent(active)) return;
    active.abortController.abort();
    this.cleanup(active);
    active.settled = true;
    this.active = null;
    active.reject(abortError());
  }

  private cleanup(active: ActiveRun): void {
    this.closeEventSource(active);
    if (active.pollTimer) clearTimeout(active.pollTimer);
    if (active.silenceTimer) clearTimeout(active.silenceTimer);
    active.pollTimer = null;
    active.silenceTimer = null;
    active.removeExternalAbort?.();
    active.removeExternalAbort = null;
  }

  private closeEventSource(active: ActiveRun): void {
    if (active.silenceTimer) clearTimeout(active.silenceTimer);
    active.silenceTimer = null;
    if (!active.eventSource) return;
    active.eventSource.onerror = null;
    active.eventSource.close();
    active.eventSource = null;
  }

  private armSilenceFallback(active: ActiveRun): void {
    if (active.silenceTimer) clearTimeout(active.silenceTimer);
    active.silenceTimer = setTimeout(
      () => this.fallbackToPolling(active),
      this.sseSilenceTimeoutMs,
    );
  }

  private emit(state: ScrapeState): void {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // A view listener cannot break transport cleanup or other listeners.
      }
    }
  }

  private isCurrent(active: ActiveRun): boolean {
    return this.active?.token === active.token && !active.settled;
  }
}
