import type { AIMessage, AIMessageAttachment } from './types';

interface ImagePartLike {
  type?: unknown;
  image?: unknown;
  filename?: unknown;
}

interface AttachmentLike {
  content?: unknown;
  contentType?: unknown;
  name?: unknown;
}

interface ThreadMessageLike {
  content: readonly unknown[];
  attachments?: readonly unknown[];
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const toImagePart = (value: unknown): ImagePartLike | null => {
  const part = asObject(value);
  if (!part || part['type'] !== 'image' || typeof part['image'] !== 'string') return null;
  return part;
};

const mimeTypeFromDataUrl = (data: string): string | null =>
  data.match(/^data:([^;]+);/)?.[1] ?? null;

export const extractPersistedImageAttachments = (
  message: ThreadMessageLike,
): AIMessageAttachment[] => {
  const images: AIMessageAttachment[] = [];
  const seen = new Set<string>();

  const append = (partValue: unknown, fallback?: AttachmentLike) => {
    const part = toImagePart(partValue);
    if (!part || typeof part.image !== 'string' || seen.has(part.image)) return;

    seen.add(part.image);
    const fallbackMimeType =
      typeof fallback?.contentType === 'string' ? fallback.contentType : 'image/jpeg';
    const filename =
      typeof part.filename === 'string'
        ? part.filename
        : typeof fallback?.name === 'string'
          ? fallback.name
          : undefined;

    images.push({
      type: 'image',
      data: part.image,
      mimeType: mimeTypeFromDataUrl(part.image) ?? fallbackMimeType,
      ...(filename ? { filename } : {}),
    });
  };

  message.content.forEach((part) => append(part));
  for (const attachmentValue of message.attachments ?? []) {
    const attachment = asObject(attachmentValue) as AttachmentLike | null;
    if (!attachment || !Array.isArray(attachment.content)) continue;
    attachment.content.forEach((part) => append(part, attachment));
  }

  return images;
};
interface RestoredImageAttachment {
  id: string;
  type: 'image';
  name: string;
  contentType: string;
  status: { type: 'complete' };
  content: Array<{
    type: 'image';
    image: string;
    filename?: string;
  }>;
}

interface RestoredMessageParts {
  content: Array<{ type: 'text'; text: string }>;
  attachments: RestoredImageAttachment[];
}
/**
 * assistant-ui renders user attachments separately from message content.
 * Keeping restored images in one channel prevents duplicate rendering.
 */
export const buildRestoredMessageParts = (message: AIMessage): RestoredMessageParts => ({
  content: message.content ? [{ type: 'text', text: message.content }] : [],
  attachments: (message.attachments ?? [])
    .filter((attachment): attachment is AIMessageAttachment & { data: string } =>
      Boolean(attachment.data),
    )
    .map((attachment, index) => ({
      id: message.id + '-attachment-' + index,
      type: 'image',
      name: attachment.filename || 'image-' + (index + 1),
      contentType: attachment.mimeType,
      status: { type: 'complete' },
      content: [
        {
          type: 'image',
          image: attachment.data,
          ...(attachment.filename ? { filename: attachment.filename } : {}),
        },
      ],
    })),
});
