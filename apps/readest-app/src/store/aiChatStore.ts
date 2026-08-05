import { create } from 'zustand';
import { AIConversation, AIMessage } from '@/services/ai/types';
import { aiStore } from '@/services/ai/storage/aiStore';
import { publishAIConversation, publishAIMessage, deleteAIConversation } from '@/services/sync/aiChatSync';

interface AIChatState {
  activeConversationId: string | null;
  conversations: AIConversation[];
  messages: AIMessage[];
  isLoadingHistory: boolean;
  currentBookHash: string | null;

  loadConversations: (bookHash: string) => Promise<void>;
  refreshConversations: (bookHash: string) => Promise<void>;
  setActiveConversation: (id: string | null) => Promise<void>;
  createConversation: (bookHash: string, title: string) => Promise<string>;
  addMessage: (message: Omit<AIMessage, 'id' | 'createdAt'>) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  clearActiveConversation: () => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const runBackgroundSync = (task: Promise<void>, failureMessage: string): void => {
  void task.catch((error) => {
    console.warn(failureMessage, error);
  });
};

export const useAIChatStore = create<AIChatState>((set, get) => ({
  activeConversationId: null,
  conversations: [],
  messages: [],
  isLoadingHistory: false,
  currentBookHash: null,

  loadConversations: async (bookHash: string) => {
    if (get().currentBookHash === bookHash && get().conversations.length > 0) {
      return;
    }
    set({ isLoadingHistory: true });
    try {
      const conversations = await aiStore.getConversations(bookHash);
      set({
        conversations,
        currentBookHash: bookHash,
        isLoadingHistory: false,
      });
    } catch {
      set({ isLoadingHistory: false });
    }
  },

  refreshConversations: async (bookHash: string) => {
    const conversations = await aiStore.getConversations(bookHash);
    set({ conversations, currentBookHash: bookHash, isLoadingHistory: false });
  },

  setActiveConversation: async (id: string | null) => {
    if (id === null) {
      set({ activeConversationId: null, messages: [] });
      return;
    }
    set({ isLoadingHistory: true });
    try {
      const messages = await aiStore.getMessages(id);
      set({
        activeConversationId: id,
        messages,
        isLoadingHistory: false,
      });
    } catch {
      set({ activeConversationId: id, messages: [], isLoadingHistory: false });
    }
  },

  createConversation: async (bookHash: string, title: string) => {
    const id = generateId();
    const now = Date.now();
    const conversation: AIConversation = {
      id,
      bookHash,
      title: title.slice(0, 50) || 'New conversation',
      createdAt: now,
      updatedAt: now,
    };
    await aiStore.saveConversation(conversation);
    runBackgroundSync(
      publishAIConversation(conversation),
      'Unable to sync newly created AI conversation',
    );
    const conversations = await aiStore.getConversations(bookHash);
    set({
      conversations,
      activeConversationId: id,
      messages: [],
      currentBookHash: bookHash,
    });
    return id;
  },

  addMessage: async (message: Omit<AIMessage, 'id' | 'createdAt'>) => {
    const fullMessage: AIMessage = {
      ...message,
      id: generateId(),
      createdAt: Date.now(),
    };
    await aiStore.saveMessage(fullMessage);
    runBackgroundSync(
      publishAIMessage(fullMessage).then(async () => {
        const messages = await aiStore.getMessages(fullMessage.conversationId);
        const persisted = messages.find((item) => item.id === fullMessage.id);
        if (persisted) {
          set((state) => ({
            messages: state.messages.map((item) => item.id === persisted.id ? persisted : item),
          }));
        }
      }),
      'Unable to sync AI message',
    );

    // update conversation updatedAt
    const { activeConversationId, currentBookHash } = get();
    if (activeConversationId && currentBookHash) {
      const conversations = get().conversations;
      const conv = conversations.find((item) => item.id === activeConversationId);
      if (conv) {
        const updatedConversation = { ...conv, updatedAt: Date.now() };
        await aiStore.saveConversation(updatedConversation);
        runBackgroundSync(
          publishAIConversation(updatedConversation),
          'Unable to sync updated AI conversation',
        );
        set((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === updatedConversation.id ? updatedConversation : item,
          ),
        }));
      }
    }

    set((state) => ({
      messages: [...state.messages, fullMessage],
    }));
  },

  deleteConversation: async (id: string) => {
    const { currentBookHash, activeConversationId } = get();
    await aiStore.deleteConversation(id);
    runBackgroundSync(deleteAIConversation(id), 'Unable to sync deleted AI conversation');

    if (currentBookHash) {
      const conversations = await aiStore.getConversations(currentBookHash);
      set({
        conversations,
        ...(activeConversationId === id ? { activeConversationId: null, messages: [] } : {}),
      });
    }
  },

  renameConversation: async (id: string, title: string) => {
    const { currentBookHash } = get();
    await aiStore.updateConversationTitle(id, title);
    const renamedConversation = get().conversations.find((item) => item.id === id);
    if (renamedConversation) {
      runBackgroundSync(
        publishAIConversation({ ...renamedConversation, title, updatedAt: Date.now() }),
        'Unable to sync renamed AI conversation',
      );
    }

    if (currentBookHash) {
      const conversations = await aiStore.getConversations(currentBookHash);
      set({ conversations });
    }
  },

  clearActiveConversation: () => {
    set({ activeConversationId: null, messages: [] });
  },
}));
