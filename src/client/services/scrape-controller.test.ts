import { describe, expect, test } from 'bun:test';
import type { PfxpDocument } from '../domain';
import type { ScrapeApi, ScrapeResponse } from './api';
import {
  ScrapeController,
  type EventSourceLike,
} from './scrape-controller';

const document: PfxpDocument = { details: [], characters: [], summary: {} };

class FakeEventSource implements EventSourceLike {
  onerror: ((event: Event) => unknown) | null = null;
  closed = false;
  private progress: ((event: MessageEvent<string>) => unknown) | null = null;

  addEventListener(_type: 'progress', listener: (event: MessageEvent<string>) => unknown): void {
    this.progress = listener;
  }

  close(): void {
    this.closed = true;
  }

  send(value: unknown): void {
    this.progress?.({ data: JSON.stringify(value) } as MessageEvent<string>);
  }
}

function fakeApi(submit: ScrapeResponse, status: ScrapeResponse): ScrapeApi {
  return {
    submit: async () => submit,
    status: async () => status,
    eventsUrl: (jobId) => `/api/events?jobId=${jobId}`,
  };
}

describe('ScrapeController', () => {
  test('closes SSE and fetches final data on ready', async () => {
    const source = new FakeEventSource();
    const controller = new ScrapeController(
      fakeApi({ status: 'queued', jobId: 'job-1' }, { status: 'ready', data: document }),
      { eventSourceFactory: () => source },
    );
    const resultPromise = controller.start('user@example.com', 'password');
    await Promise.resolve();
    source.send({ jobId: 'job-1', status: 'ready', ts: Date.now() });
    const result = await resultPromise;
    expect(source.closed).toBe(true);
    expect(result).toMatchObject({ status: 'ready', data: document });
  });

  test('uses polling when EventSource is unavailable', async () => {
    const controller = new ScrapeController(
      fakeApi({ status: 'processing' }, { status: 'ready', data: document }),
      { eventSourceFactory: null },
    );
    await expect(controller.start('user@example.com', 'password')).resolves.toMatchObject({
      status: 'ready',
      source: 'poll',
    });
  });

  test('does not mistake an idle queued user for a failed job during SSE fallback', async () => {
    let statusCalls = 0;
    const api: ScrapeApi = {
      submit: async () => ({ status: 'queued', jobId: 'job-queued' }),
      status: async () => {
        statusCalls += 1;
        return statusCalls === 1
          ? { status: 'error', message: 'An error occurred while fetching your data.' }
          : { status: 'ready', data: document };
      },
      eventsUrl: (jobId) => `/api/events?jobId=${jobId}`,
    };
    const updates: string[] = [];
    const controller = new ScrapeController(api, {
      eventSourceFactory: null,
      pollIntervalMs: 250,
    });
    controller.subscribe((state) => updates.push(state.status));
    await expect(controller.start('user@example.com', 'password')).resolves.toMatchObject({
      status: 'ready',
    });
    expect(updates).toEqual(['queued', 'queued', 'ready']);
  });

  test('closes SSE on blocked progress', async () => {
    const source = new FakeEventSource();
    let statusCalls = 0;
    const controller = new ScrapeController(
      {
        submit: async () => ({ status: 'queued', jobId: 'job-2' }),
        status: async () => {
          statusCalls += 1;
          return { status: 'ready', data: document };
        },
        eventsUrl: (jobId) => `/api/events?jobId=${jobId}`,
      },
      { eventSourceFactory: () => source },
    );
    const resultPromise = controller.start('user@example.com', 'password');
    await Promise.resolve();
    source.send({ jobId: 'job-2', status: 'blocked', ts: Date.now() });
    await expect(resultPromise).resolves.toMatchObject({ status: 'blocked', source: 'sse' });
    expect(source.closed).toBe(true);
    expect(statusCalls).toBe(0);
  });

  test('does not replace an SSE error with cached data from an older run', async () => {
    const source = new FakeEventSource();
    let statusCalls = 0;
    const controller = new ScrapeController({
      submit: async () => ({ status: 'queued', jobId: 'job-3' }),
      status: async () => {
        statusCalls += 1;
        return { status: 'ready', data: document };
      },
      eventsUrl: (jobId) => `/api/events?jobId=${jobId}`,
    }, { eventSourceFactory: () => source });
    const resultPromise = controller.start('user@example.com', 'password');
    await Promise.resolve();
    source.send({ jobId: 'job-3', status: 'error', message: 'Current run failed', ts: Date.now() });
    await expect(resultPromise).resolves.toMatchObject({ status: 'error', message: 'Current run failed' });
    expect(statusCalls).toBe(0);
  });
});
