import { afterEach, describe, expect, test, vi } from 'vitest';

import { AIStore } from '@/services/ai/storage/aiStore';

interface MutableOpenRequest {
  result: IDBDatabase;
  onerror: ((event: Event) => void) | null;
  onsuccess: ((event: Event) => void) | null;
  onblocked: ((event: Event) => void) | null;
  onupgradeneeded: ((event: IDBVersionChangeEvent) => void) | null;
}

const createOpenRequest = (): MutableOpenRequest => ({
  result: {
    close: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => true) },
  } as unknown as IDBDatabase,
  onerror: null,
  onsuccess: null,
  onblocked: null,
  onupgradeneeded: null,
});

describe('AIStore database opening', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('shares one IndexedDB open request across concurrent first access', async () => {
    const request = createOpenRequest();
    const open = vi.fn(() => request as unknown as IDBOpenDBRequest);
    vi.stubGlobal('indexedDB', { open });

    const store = new AIStore();
    const first = store.recoverFromError();
    const second = store.recoverFromError();

    expect(open).toHaveBeenCalledTimes(1);
    request.onsuccess?.(new Event('success'));
    await Promise.all([first, second]);
  });

  test('rejects a blocked IndexedDB upgrade instead of loading forever', async () => {
    const request = createOpenRequest();
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => request as unknown as IDBOpenDBRequest),
    });

    const store = new AIStore();
    const opening = store.recoverFromError();
    request.onblocked?.(new Event('blocked'));

    await expect(opening).rejects.toThrow('blocked');
  });
});
