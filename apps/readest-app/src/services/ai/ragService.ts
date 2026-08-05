import { embed, embedMany } from 'ai';
import { aiStore } from './storage/aiStore';
import { chunkSection, extractTextFromDocument } from './utils/chunker';
import { withRetryAndTimeout, AI_TIMEOUTS, AI_RETRY_CONFIGS } from './utils/retry';
import { getAIProvider } from './providers';
import { aiLogger } from './logger';
import type { AISettings, TextChunk, ScoredChunk, EmbeddingProgress, BookIndexMeta } from './types';

interface SectionItem {
  id: string;
  size: number;
  linear: string;
  createDocument: () => Promise<Document>;
}

interface TOCItem {
  id: number;
  label: string;
  href?: string;
}

export interface BookDocType {
  sections?: SectionItem[];
  toc?: TOCItem[];
  metadata?: { title?: string | { [key: string]: string }; author?: string | { name?: string } };
}

const indexingStates = new Map<string, IndexingState>();
const indexingPromises = new Map<string, Promise<void>>();

export async function isBookIndexed(bookHash: string): Promise<boolean> {
  const indexed = await aiStore.isIndexed(bookHash);
  aiLogger.rag.isIndexed(bookHash, indexed);
  return indexed;
}

function extractTitle(metadata?: BookDocType['metadata']): string {
  if (!metadata?.title) return 'Unknown Book';
  if (typeof metadata.title === 'string') return metadata.title;
  return (
    metadata.title['en'] ||
    metadata.title['default'] ||
    Object.values(metadata.title)[0] ||
    'Unknown Book'
  );
}

function extractAuthor(metadata?: BookDocType['metadata']): string {
  if (!metadata?.author) return 'Unknown Author';
  if (typeof metadata.author === 'string') return metadata.author;
  return metadata.author.name || 'Unknown Author';
}

function getChapterTitle(toc: TOCItem[] | undefined, sectionIndex: number): string {
  if (!toc || toc.length === 0) return `Section ${sectionIndex + 1}`;
  for (let i = toc.length - 1; i >= 0; i--) {
    if (toc[i]!.id <= sectionIndex) return toc[i]!.label;
  }
  return toc[0]?.label || `Section ${sectionIndex + 1}`;
}

function getEmbeddingModelName(settings: AISettings): string {
  switch (settings.provider) {
    case 'ollama':
      return settings.ollamaEmbeddingModel?.trim() || '';
    case 'openrouter':
      // OpenAI-compatible endpoints are allowed to provide chat only.
      return settings.openrouterEmbeddingModel?.trim() || '';
    default:
      return settings.aiGatewayEmbeddingModel?.trim() || 'openai/text-embedding-3-small';
  }
}

export async function indexBook(
  bookDoc: BookDocType,
  bookHash: string,
  settings: AISettings,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<void> {
  const existing = indexingPromises.get(bookHash);
  if (existing) return existing;

  const promise = indexBookInternal(bookDoc, bookHash, settings, onProgress);
  indexingPromises.set(bookHash, promise);
  try {
    await promise;
  } finally {
    if (indexingPromises.get(bookHash) === promise) indexingPromises.delete(bookHash);
  }
}

async function indexBookInternal(
  bookDoc: BookDocType,
  bookHash: string,
  settings: AISettings,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<void> {
  const startTime = Date.now();
  const title = extractTitle(bookDoc.metadata);

  if (await aiStore.isIndexed(bookHash)) {
    aiLogger.rag.isIndexed(bookHash, true);
    return;
  }

  aiLogger.rag.indexStart(bookHash, title);
  const provider = getAIProvider(settings);
  const sections = bookDoc.sections || [];
  const toc = bookDoc.toc || [];

  // calculate cumulative character sizes like toc.ts does
  const sizes = sections.map((s) => (s.linear !== 'no' && s.size > 0 ? s.size : 0));
  let cumulative = 0;
  const cumulativeSizes = sizes.map((size) => {
    const current = cumulative;
    cumulative += size;
    return current;
  });

  const state: IndexingState = {
    bookHash,
    status: 'indexing',
    progress: 0,
    chunksProcessed: 0,
    totalChunks: 0,
  };
  indexingStates.set(bookHash, state);

  try {
    onProgress?.({ current: 0, total: 1, phase: 'chunking' });
    aiLogger.rag.indexProgress('chunking', 0, sections.length);
    const allChunks: TextChunk[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      try {
        const doc = await section.createDocument();
        const text = extractTextFromDocument(doc);
        if (text.length < 100) continue;
        const sectionChunks = chunkSection(
          doc,
          i,
          getChapterTitle(toc, i),
          bookHash,
          cumulativeSizes[i] ?? 0,
        );
        aiLogger.chunker.section(i, text.length, sectionChunks.length);
        allChunks.push(...sectionChunks);
      } catch (e) {
        aiLogger.chunker.error(i, (e as Error).message);
      }
    }

    aiLogger.chunker.complete(bookHash, allChunks.length);
    state.totalChunks = allChunks.length;

    if (allChunks.length === 0) {
      state.status = 'complete';
      state.progress = 100;
      aiLogger.rag.indexComplete(bookHash, 0, Date.now() - startTime);
      return;
    }

    const embeddingModelName = getEmbeddingModelName(settings);
    if (embeddingModelName) {
      onProgress?.({ current: 0, total: allChunks.length, phase: 'embedding' });
      aiLogger.embedding.start(embeddingModelName, allChunks.length);

      const batchSize = settings.provider === 'ollama' ? 4 : 16;
      const embeddingModel = provider.getEmbeddingModel();
      try {
        let embeddedCount = 0;
        for (let offset = 0; offset < allChunks.length; offset += batchSize) {
          const batch = allChunks.slice(offset, offset + batchSize);
          const { embeddings } = await withRetryAndTimeout(
            () =>
              embedMany({
                model: embeddingModel,
                values: batch.map((chunk) => chunk.text),
              }),
            AI_TIMEOUTS.EMBEDDING_BATCH,
            AI_RETRY_CONFIGS.EMBEDDING,
          );
          if (embeddings.length !== batch.length) {
            throw new Error(
              'Embedding model returned ' + embeddings.length + ' vectors for ' + batch.length + ' inputs',
            );
          }
          for (let i = 0; i < batch.length; i++) {
            batch[i]!.embedding = embeddings[i];
          }
          embeddedCount += batch.length;
          state.chunksProcessed = embeddedCount;
          state.progress = Math.round((embeddedCount / allChunks.length) * 100);
          onProgress?.({ current: embeddedCount, total: allChunks.length, phase: 'embedding' });
          aiLogger.embedding.batch(embeddedCount, allChunks.length);
        }
        aiLogger.embedding.complete(
          state.chunksProcessed,
          allChunks.length,
          allChunks[0]?.embedding?.length || 0,
        );
      } catch (e) {
        aiLogger.embedding.error('batch', (e as Error).message);
        throw e;
      }
    } else {
      // The UI documents embedding as optional. Keep chat and BM25 usable
      // for compatible endpoints that expose chat completions only.
      state.chunksProcessed = 0;
      state.progress = 100;
      onProgress?.({ current: allChunks.length, total: allChunks.length, phase: 'embedding' });
      aiLogger.rag.indexProgress('embedding skipped', allChunks.length, allChunks.length);
    }

    onProgress?.({ current: 0, total: 2, phase: 'indexing' });
    aiLogger.store.saveChunks(bookHash, allChunks.length);
    await aiStore.saveChunks(allChunks);

    onProgress?.({ current: 1, total: 2, phase: 'indexing' });
    aiLogger.store.saveBM25(bookHash);
    await aiStore.saveBM25Index(bookHash, allChunks);

    const meta: BookIndexMeta = {
      bookHash,
      bookTitle: title,
      authorName: extractAuthor(bookDoc.metadata),
      totalSections: sections.length,
      totalChunks: allChunks.length,
      embeddingModel: embeddingModelName || 'none',
      lastUpdated: Date.now(),
    };
    aiLogger.store.saveMeta(meta);
    await aiStore.saveMeta(meta);

    onProgress?.({ current: 2, total: 2, phase: 'indexing' });
    state.status = 'complete';
    state.progress = 100;
    aiLogger.rag.indexComplete(bookHash, allChunks.length, Date.now() - startTime);
  } catch (error) {
    state.status = 'error';
    state.error = (error as Error).message;
    aiLogger.rag.indexError(bookHash, (error as Error).message);
    throw error;
  }
}

export async function hybridSearch(
  bookHash: string,
  query: string,
  settings: AISettings,
  topK = 10,
  maxPage?: number,
): Promise<ScoredChunk[]> {
  aiLogger.search.query(query, maxPage);
  const provider = getAIProvider(settings);
  let queryEmbedding: number[] | null = null;

  if (getEmbeddingModelName(settings)) {
    try {
      // use AI SDK embed with provider's embedding model
      const { embedding } = await withRetryAndTimeout(
        () =>
          embed({
            model: provider.getEmbeddingModel(),
            value: query,
          }),
        AI_TIMEOUTS.EMBEDDING_SINGLE,
        AI_RETRY_CONFIGS.EMBEDDING,
      );
      queryEmbedding = embedding;
    } catch {
      // bm25 only fallback
    }
  }

  const results = await aiStore.hybridSearch(bookHash, queryEmbedding, query, topK, maxPage);
  aiLogger.search.hybridResults(results.length, [...new Set(results.map((r) => r.searchMethod))]);
  return results;
}

export async function clearBookIndex(bookHash: string): Promise<void> {
  aiLogger.store.clear(bookHash);
  await aiStore.clearBook(bookHash);
  indexingStates.delete(bookHash);
}

// internal type for indexing state tracking
interface IndexingState {
  bookHash: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  progress: number;
  chunksProcessed: number;
  totalChunks: number;
  error?: string;
}
