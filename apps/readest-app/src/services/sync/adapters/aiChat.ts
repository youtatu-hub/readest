import type { AIConversation, AIMessage, AIMessageAttachment } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';
import type { ReplicaAdapter } from '@/services/sync/replicaRegistry';
import type { FieldsObject, ReplicaRow } from '@/types/replica';
import { unwrap } from './helpers';

export const AI_CHAT_KIND = 'ai_chat';
export const AI_CHAT_MESSAGE_KIND = 'ai_chat_message';
export const AI_CHAT_ATTACHMENT_KIND = 'ai_chat_attachment';
export const AI_CHAT_SCHEMA_VERSION = 2;

export interface AIChatSyncRecord { id: string; name: string; conversation: AIConversation; messages?: AIMessage[]; }
export interface AIChatMessageSyncRecord { id: string; name: string; message: AIMessage; }
export interface AIChatAttachmentSyncRecord {
  contentId: string;
  name: string;
  conversationId: string;
  messageId: string;
  mimeType: string;
  filename?: string;
  path: string;
  byteSize: number;
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
const fieldsOf = (row: ReplicaRow): Record<string, unknown> => Object.fromEntries(
  Object.entries(row.fields_jsonb as FieldsObject).map(([key, value]) => [key, unwrap(value)]),
);
const asString = (value: unknown): string => typeof value === 'string' ? value : '';
const asNumber = (value: unknown): number => Number(value ?? 0);
const downloadedAttachments = new Map<string, AIChatAttachmentSyncRecord>();

export const rememberAIChatAttachment = (record: AIChatAttachmentSyncRecord): void => {
  downloadedAttachments.set(record.contentId, record);
};

export const restoreAIChatAttachment = async (
  contentId: string,
  fs: BinaryFileReader,
): Promise<void> => {
  const record = downloadedAttachments.get(contentId);
  if (record) await restoreAttachmentData(record, fs);
};

/** Restore immediately when a binary was already cached from an earlier pull. */
export const restoreCachedAIChatAttachment = async (
  record: AIChatAttachmentSyncRecord,
  fs: BinaryFileReader,
): Promise<void> => {
  rememberAIChatAttachment(record);
  try {
    await restoreAttachmentData(record, fs);
  } catch {
    // The regular binary download completion handler retries after the file lands.
  }
};

type BinaryFileReader = Pick<import('@/types/system').FileSystem, 'readFile'>;

const bytesToDataUrl = (bytes: ArrayBuffer, mimeType: string): string => {
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < view.length; offset += 0x8000) {
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

/** Conversation metadata only. Messages are separate Replica rows. */
export const aiChatAdapter: ReplicaAdapter<AIChatSyncRecord> = {
  kind: AI_CHAT_KIND,
  schemaVersion: AI_CHAT_SCHEMA_VERSION,
  pack: ({ conversation }) => ({ bookHash: conversation.bookHash, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt }),
  unpack: (fields) => {
    const conversation: AIConversation = { id: asString(fields['id']), bookHash: asString(fields['bookHash']), title: asString(fields['title']), createdAt: asNumber(fields['createdAt']), updatedAt: asNumber(fields['updatedAt']) };
    return { id: conversation.id, name: conversation.title, conversation };
  },
  computeId: async ({ id }) => id,
  unpackRow: (row) => {
    const fields = fieldsOf(row); const bookHash = asString(fields['bookHash']); const title = asString(fields['title']);
    if (!bookHash || !title) return null;
    const conversation = { id: row.replica_id, bookHash, title, createdAt: asNumber(fields['createdAt']), updatedAt: asNumber(fields['updatedAt']) };
    // Schema v1 stored all messages in this row. Retain them during the
    // migration; new writes use ai_chat_message rows instead.
    const messages = parseJson<AIMessage[]>(fields['messages'], []).filter(
      (message) => message && message.conversationId === row.replica_id,
    );
    return { id: row.replica_id, name: title, conversation, ...(messages.length ? { messages } : {}) };
  },
};

/** One message per row prevents long conversations from exceeding the 64 KiB row cap. */
export const aiChatMessageAdapter: ReplicaAdapter<AIChatMessageSyncRecord> = {
  kind: AI_CHAT_MESSAGE_KIND,
  schemaVersion: 1,
  pack: ({ message }) => ({
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
    // Image bytes are binary replicas. This stores only stable references.
    attachments: JSON.stringify((message.attachments ?? []).map(({ data: _data, ...attachment }) => attachment)),
  }),
  unpack: (fields) => {
    const message: AIMessage = { id: asString(fields['id']), conversationId: asString(fields['conversationId']), role: fields['role'] === 'assistant' ? 'assistant' : 'user', content: asString(fields['content']), createdAt: asNumber(fields['createdAt']), attachments: parseJson<AIMessageAttachment[]>(fields['attachments'], []) };
    return { id: message.id, name: 'AI message', message };
  },
  computeId: async ({ id }) => id,
  unpackRow: (row) => {
    const fields = fieldsOf(row); const conversationId = asString(fields['conversationId']); const role = fields['role'];
    if (!conversationId || (role !== 'user' && role !== 'assistant')) return null;
    const message: AIMessage = { id: row.replica_id, conversationId, role, content: asString(fields['content']), createdAt: asNumber(fields['createdAt']), attachments: parseJson<AIMessageAttachment[]>(fields['attachments'], []) };
    return { id: row.replica_id, name: 'AI message', message };
  },
};

/** A single image is a binary Replica file with a small metadata row. */
export const aiChatAttachmentAdapter: ReplicaAdapter<AIChatAttachmentSyncRecord> = {
  kind: AI_CHAT_ATTACHMENT_KIND,
  schemaVersion: 1,
  pack: (record) => ({ conversationId: record.conversationId, messageId: record.messageId, mimeType: record.mimeType, filename: record.filename ?? '', path: record.path, byteSize: record.byteSize }),
  unpack: (fields) => ({ contentId: asString(fields['id']), name: asString(fields['filename']) || 'AI image', conversationId: asString(fields['conversationId']), messageId: asString(fields['messageId']), mimeType: asString(fields['mimeType']), filename: asString(fields['filename']) || undefined, path: asString(fields['path']), byteSize: asNumber(fields['byteSize']) }),
  computeId: async ({ contentId }) => contentId,
  unpackRow: (row, bundleDir) => {
    const fields = fieldsOf(row); const messageId = asString(fields['messageId']); const mimeType = asString(fields['mimeType']); const binary = row.manifest_jsonb?.files[0];
    if (!messageId || !mimeType || !binary) return null;
    return { contentId: row.replica_id, name: asString(fields['filename']) || 'AI image', conversationId: asString(fields['conversationId']), messageId, mimeType, filename: asString(fields['filename']) || undefined, path: `${bundleDir}/${binary.filename}`, byteSize: asNumber(fields['byteSize']) };
  },
  binary: {
    localBaseDir: 'Images',
    enumerateFiles: (record) => [{ logical: record.path.split('/').pop() ?? record.path, lfp: record.path, byteSize: record.byteSize }],
  },
  lifecycle: {
    postDownload: (record, fs) => restoreAttachmentData(record, fs),
  },
};

const restoreAttachmentData = async (
  record: AIChatAttachmentSyncRecord,
  fs: BinaryFileReader,
): Promise<void> => {
  const bytes = await fs.readFile(record.path, 'Images', 'binary') as ArrayBuffer;
  // Message and binary pulls are concurrent. Wait briefly for the message
  // metadata row before restoring its local display Data URL.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const messages = await aiStore.getMessages(record.conversationId);
    const message = messages.find((item) => item.id === record.messageId);
    if (message) {
      const attachments = (message.attachments ?? []).map((attachment) =>
        attachment.syncId === record.contentId
          ? { ...attachment, data: bytesToDataUrl(bytes, record.mimeType) }
          : attachment,
      );
      await aiStore.saveMessage({ ...message, ...(attachments.length ? { attachments } : {}) });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
