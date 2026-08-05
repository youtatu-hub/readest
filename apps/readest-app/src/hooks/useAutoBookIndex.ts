import { useEffect, useRef } from 'react';

interface UseAutoBookIndexOptions {
  bookHash: string;
  ready: boolean;
  startIndexing: () => void | Promise<void>;
}

/**
 * Starts a missing book index once per mounted book. Callers keep ownership
 * of status checks, progress, and errors so failed indexing remains explicit.
 */
export const useAutoBookIndex = ({
  bookHash,
  ready,
  startIndexing,
}: UseAutoBookIndexOptions): void => {
  const startedBookRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bookHash || !ready || startedBookRef.current === bookHash) return;
    startedBookRef.current = bookHash;
    void startIndexing();
  }, [bookHash, ready, startIndexing]);
};
