import { describe, expect, it } from 'vitest';
import { waitForIDBTransaction } from '@/services/webAppService';

describe('waitForIDBTransaction', () => {
  it('rejects when IndexedDB aborts a write transaction', async () => {
    const abortError = new DOMException('The transaction was aborted', 'AbortError');
    const transaction = {
      error: abortError,
      oncomplete: null,
      onerror: null,
      onabort: null,
    } as unknown as IDBTransaction;

    const completion = waitForIDBTransaction(transaction);
    transaction.onabort?.(
      new Event('abort') as Event & {
        target: IDBTransaction;
      },
    );

    await expect(completion).rejects.toBe(abortError);
  });
});
