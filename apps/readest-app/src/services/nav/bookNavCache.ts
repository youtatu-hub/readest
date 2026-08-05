import type { Book, ConvertChineseVariant } from '@/types/book';
import type { BookDoc, TOCItem } from '@/libs/document';
import type { AppService } from '@/types/system';
import { BOOK_NAV_VERSION, computeBookNav, hydrateBookNav, updateToc } from '@/services/nav';

type BookNavService = Pick<AppService, 'loadBookNav' | 'saveBookNav'>;
type ScheduleTask = (task: () => void) => void;

interface PrepareBookNavigationOptions {
  appService: BookNavService;
  book: Book;
  bookDoc: BookDoc;
  sortedTOC: boolean;
  convertChineseVariant: ConvertChineseVariant;
  onHydrated?: () => void;
  schedule?: ScheduleTask;
}

const activeBuilds = new Set<string>();

const scheduleAfterFirstPaint: ScheduleTask = (task) => {
  if (typeof globalThis.requestIdleCallback === 'function') {
    globalThis.requestIdleCallback(task, { timeout: 2_000 });
    return;
  }
  setTimeout(task, 0);
};

export const prepareBookNavigation = async ({
  appService,
  book,
  bookDoc,
  sortedTOC,
  convertChineseVariant,
  onHydrated,
  schedule = scheduleAfterFirstPaint,
}: PrepareBookNavigationOptions): Promise<void> => {
  const cachedNav = await appService.loadBookNav(book);
  if (cachedNav?.version === BOOK_NAV_VERSION && process.env.NODE_ENV === 'production') {
    hydrateBookNav(bookDoc, cachedNav);
    await updateToc(bookDoc, sortedTOC, convertChineseVariant);
    return;
  }

  const sourceToc = structuredClone(bookDoc.toc ?? []) as TOCItem[];
  await updateToc(bookDoc, sortedTOC, convertChineseVariant);

  if (activeBuilds.has(book.hash)) return;
  activeBuilds.add(book.hash);

  schedule(() => {
    void (async () => {
      try {
        const freshNav = await computeBookNav(bookDoc, sourceToc);
        hydrateBookNav(bookDoc, freshNav);
        await updateToc(bookDoc, sortedTOC, convertChineseVariant);
        onHydrated?.();
        await appService.saveBookNav(book, freshNav);
      } catch (error) {
        console.warn('Failed to build book navigation cache:', error);
      } finally {
        activeBuilds.delete(book.hash);
      }
    })();
  });
};
