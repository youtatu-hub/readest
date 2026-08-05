import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { useAutoBookIndex } from '@/hooks/useAutoBookIndex';

describe('useAutoBookIndex', () => {
  test('starts once when a missing index is ready and resets for another book', async () => {
    const startIndexing = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ bookHash, ready }) => useAutoBookIndex({ bookHash, ready, startIndexing }),
      { initialProps: { bookHash: 'book-a', ready: false } },
    );

    expect(startIndexing).not.toHaveBeenCalled();

    rerender({ bookHash: 'book-a', ready: true });
    await waitFor(() => expect(startIndexing).toHaveBeenCalledTimes(1));

    rerender({ bookHash: 'book-a', ready: true });
    expect(startIndexing).toHaveBeenCalledTimes(1);

    rerender({ bookHash: 'book-b', ready: true });
    await waitFor(() => expect(startIndexing).toHaveBeenCalledTimes(2));
  });
});
