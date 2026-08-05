import { waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { Book } from '@/types/book';

const navMocks = vi.hoisted(() => ({
  computeBookNav: vi.fn(),
  hydrateBookNav: vi.fn(),
  updateToc: vi.fn(async () => undefined),
}));

vi.mock('@/services/nav', () => ({
  BOOK_NAV_VERSION: 3,
  ...navMocks,
}));

import { prepareBookNavigation } from '@/services/nav/bookNavCache';

describe('prepareBookNavigation', () => {
  test('does not block first open while a missing navigation cache is built', async () => {
    const freshNav = { version: 3, toc: [], sections: {} };
    let finishBuild: ((value: typeof freshNav) => void) | undefined;
    navMocks.computeBookNav.mockReturnValue(
      new Promise((resolve) => {
        finishBuild = resolve;
      }),
    );

    const appService = {
      loadBookNav: vi.fn(async () => null),
      saveBookNav: vi.fn(async () => undefined),
    };
    const book = { hash: 'book-a', format: 'EPUB' } as unknown as Book;
    const bookDoc = {
      toc: [{ label: 'Chapter 1', href: 'chapter-1.xhtml' }],
      rendition: { layout: 'reflowable' },
    } as unknown as BookDoc;

    await prepareBookNavigation({
      appService,
      book,
      bookDoc,
      sortedTOC: false,
      convertChineseVariant: 'none',
      schedule: (task) => task(),
    });

    expect(navMocks.computeBookNav).toHaveBeenCalledTimes(1);
    expect(appService.saveBookNav).not.toHaveBeenCalled();

    finishBuild?.(freshNav);
    await waitFor(() => expect(appService.saveBookNav).toHaveBeenCalledWith(book, freshNav));
  });
});
