import { describe, expect, test } from 'vitest';

import {
  buildRestoredMessageParts,
  extractPersistedImageAttachments,
} from '@/services/ai/messagePersistence';

describe('extractPersistedImageAttachments', () => {
  test('reads images from assistant-ui attachment content', () => {
    const attachments = extractPersistedImageAttachments({
      content: [{ type: 'text', text: 'What is shown here?' }],
      attachments: [
        {
          type: 'image',
          name: 'page.png',
          contentType: 'image/png',
          content: [{ type: 'image', image: 'data:image/png;base64,abc123' }],
        },
      ],
    });

    expect(attachments).toEqual([
      {
        type: 'image',
        data: 'data:image/png;base64,abc123',
        mimeType: 'image/png',
        filename: 'page.png',
      },
    ]);
  });

  test('does not duplicate an image present in content and attachments', () => {
    const image = {
      type: 'image',
      image: 'data:image/jpeg;base64,same',
      filename: 'photo.jpg',
    };
    const attachments = extractPersistedImageAttachments({
      content: [image],
      attachments: [
        {
          type: 'image',
          name: 'photo.jpg',
          contentType: 'image/jpeg',
          content: [image],
        },
      ],
    });

    expect(attachments).toHaveLength(1);
  });
});

describe('buildRestoredMessageParts', () => {
  test('restores a saved image only through the attachment channel', () => {
    const image = 'data:image/png;base64,restored';
    const parts = buildRestoredMessageParts({
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: 'Describe this page',
      createdAt: 1,
      attachments: [
        {
          type: 'image',
          data: image,
          mimeType: 'image/png',
          filename: 'page.png',
        },
      ],
    });

    expect(parts.content).toEqual([{ type: 'text', text: 'Describe this page' }]);
    expect(parts.attachments).toHaveLength(1);
    expect(parts.attachments[0]?.content).toEqual([{ type: 'image', image, filename: 'page.png' }]);
    expect(JSON.stringify(parts).match(new RegExp(image, 'g'))).toHaveLength(1);
  });
});
