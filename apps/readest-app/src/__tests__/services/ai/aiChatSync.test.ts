import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AIChatSyncRecord } from '@/services/sync/adapters/aiChat';

const storeMocks = vi.hoisted(() => ({
  isConversationDeleted: vi.fn<(id: string) => Promise<boolean>>(),
  saveConversation: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock('@/services/ai/storage/aiStore', () => ({
  aiStore: storeMocks,
}));

import { applyRemoteAIConversation } from '@/services/sync/aiChatSync';

const record: AIChatSyncRecord = {
  id: 'conversation-1',
  name: 'History',
  conversation: {
    id: 'conversation-1',
    bookHash: 'book-1',
    title: 'History',
    createdAt: 1,
    updatedAt: 2,
  },
  messages: [
    {
      id: 'message-1',
      conversationId: 'conversation-1',
      role: 'user',
      content: 'Hello',
      createdAt: 3,
    },
  ],
};

describe('applyRemoteAIConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('does not resurrect a locally deleted conversation', async () => {
    storeMocks.isConversationDeleted.mockResolvedValue(true);

    await applyRemoteAIConversation(record);

    expect(storeMocks.isConversationDeleted).toHaveBeenCalledWith('conversation-1');
    expect(storeMocks.saveConversation).not.toHaveBeenCalled();
    expect(storeMocks.saveMessage).not.toHaveBeenCalled();
  });

  test('imports a live remote conversation and its legacy inline messages', async () => {
    storeMocks.isConversationDeleted.mockResolvedValue(false);

    await applyRemoteAIConversation(record);

    expect(storeMocks.saveConversation).toHaveBeenCalledWith(record.conversation);
    expect(storeMocks.saveMessage).toHaveBeenCalledWith(record.messages?.[0]);
  });
});
