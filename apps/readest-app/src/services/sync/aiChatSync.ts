import type { AIConversation, AIMessage, AIMessageAttachment } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';
import { dataUrlToBytes, imageExtensionFromMime } from '@/utils/image';
import { getInitializedAppService } from '@/services/environment';
import { publishReplicaDelete, publishReplicaUpsert } from '@/services/sync/replicaPublish';
import { queueReplicaBinaryUpload } from '@/services/sync/replicaBinaryUpload';
import {
  AI_CHAT_ATTACHMENT_KIND,
  AI_CHAT_KIND,
  AI_CHAT_MESSAGE_KIND,
  type AIChatAttachmentSyncRecord,
  type AIChatMessageSyncRecord,
  type AIChatSyncRecord,
} from './adapters/aiChat';

const ATTACHMENT_DIR = 'ai-chat';
const attachmentId = (messageId: string, index: number) => `${messageId}-image-${index}`;

/**
 * Stage Data URL attachments as app files before publishing the message. The
 * local Data URL remains in IndexedDB even if binary staging/upload fails.
 */
const prepareAttachments = async (
  message: AIMessage,
): Promise<AIMessageAttachment[] | undefined> => {
  const appService = getInitializedAppService();
  const currentAttachments = message.attachments;
  if (!appService || !currentAttachments?.length) return currentAttachments;

  const prepared = await Promise.all(
    currentAttachments.map(async (attachment, index) => {
      if (!attachment.data || attachment.syncId) return attachment;
      const syncId = attachmentId(message.id, index);
      const path = `${ATTACHMENT_DIR}/${syncId}.${imageExtensionFromMime(attachment.mimeType)}`;
      try {
        const { bytes } = dataUrlToBytes(attachment.data);
        const fileBytes = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(fileBytes).set(bytes);
        await appService.createDir(ATTACHMENT_DIR, 'Images', true);
        await appService.writeFile(path, 'Images', fileBytes);
        const record: AIChatAttachmentSyncRecord = {
          contentId: syncId,
          name: attachment.filename || 'AI image',
          conversationId: message.conversationId,
          messageId: message.id,
          mimeType: attachment.mimeType,
          filename: attachment.filename,
          path,
          byteSize: bytes.byteLength,
        };
        await publishReplicaUpsert(AI_CHAT_ATTACHMENT_KIND, record, syncId);
        void queueReplicaBinaryUpload(AI_CHAT_ATTACHMENT_KIND, record, appService).catch(
          (error) => {
            console.warn('Unable to upload AI image attachment', error);
          },
        );
        return { ...attachment, syncId };
      } catch (error) {
        console.warn('Unable to stage AI image attachment for sync', error);
        return attachment;
      }
    }),
  );
  return prepared.some((attachment, index) => attachment !== currentAttachments[index])
    ? prepared
    : currentAttachments;
};

export const publishAIConversation = async (conversation: AIConversation): Promise<void> => {
  const record: AIChatSyncRecord = { id: conversation.id, name: conversation.title, conversation };
  await publishReplicaUpsert(AI_CHAT_KIND, record, conversation.id);
};

/** Each message has its own small Replica row; Data URLs are never serialized into it. */
export const publishAIMessage = async (message: AIMessage): Promise<void> => {
  const attachments = await prepareAttachments(message);
  if (attachments !== message.attachments) {
    message = { ...message, attachments };
    await aiStore.saveMessage(message);
  }
  const record: AIChatMessageSyncRecord = { id: message.id, name: 'AI message', message };
  await publishReplicaUpsert(AI_CHAT_MESSAGE_KIND, record, message.id);
};

export const deleteAIConversation = async (conversationId: string): Promise<void> => {
  await publishReplicaDelete(AI_CHAT_KIND, conversationId);
};

export const applyRemoteAIConversation = async (record: AIChatSyncRecord): Promise<void> => {
  if (await aiStore.isConversationDeleted(record.conversation.id)) return;
  await aiStore.saveConversation(record.conversation);
  // Compatibility import for schema v1's inline history. Images may be
  // present locally, but future syncs use binary attachment references.
  for (const message of record.messages ?? []) await aiStore.saveMessage(message);
};

/** Preserve already-downloaded local image data when a remote reference arrives first. */
export const applyRemoteAIMessage = async (record: AIChatMessageSyncRecord): Promise<void> => {
  const existing = (await aiStore.getMessages(record.message.conversationId)).find(
    (message) => message.id === record.message.id,
  );
  const localAttachments = new Map(
    (existing?.attachments ?? [])
      .filter((attachment) => attachment.syncId && attachment.data)
      .map((attachment) => [attachment.syncId!, attachment]),
  );
  const attachments = (record.message.attachments ?? []).map(
    (attachment) => localAttachments.get(attachment.syncId ?? '') ?? attachment,
  );
  await aiStore.saveMessage({
    ...record.message,
    ...(attachments.length > 0 ? { attachments } : {}),
  });
};
