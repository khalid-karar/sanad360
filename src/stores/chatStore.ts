// ═════════════════════════════════════════════════════════════
// ⚠ DEV MOCK — NOT A REAL FEATURE ⚠
// This chat store is session-local Zustand state with NO backend: messages
// are never persisted or delivered to another user. It exists only for UI
// demos. Its entry point (ChatBubble in App.tsx) is gated behind
// import.meta.env.DEV and is excluded from production builds. Do not wire
// product features to it; replace wholesale when real messaging lands.
// ═════════════════════════════════════════════════════════════
import { create } from 'zustand';
import { useAuthStore } from './authStore'; // To get current user and isRTL
import { useNotificationStore } from './notificationStore'; // To send chat notifications

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: Date;
  read: boolean;
}

export interface ChatUser {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  isOnline: boolean;
}

export interface Conversation {
  id: string;
  participants: string[]; // Array of user IDs
  messages: ChatMessage[];
  lastMessageTimestamp: Date;
  unreadCount: number;
}

interface ChatState {
  users: ChatUser[];
  conversations: Conversation[];
  activeConversationId: string | null;
  isChatOpen: boolean;
  sendMessage: (conversationId: string, text: string) => void;
  startNewConversation: (participantIds: string[]) => string;
  setActiveConversation: (conversationId: string | null) => void;
  markMessagesAsRead: (conversationId: string) => void;
  toggleChat: () => void;
  // Mock functions for simulating real-time
  _receiveMessage: (conversationId: string, senderId: string, text: string) => void;
  _simulateTyping: (conversationId: string, userId: string) => void;
}

const mockUsers: ChatUser[] = [
  { id: '1', name: 'أحمد محمد (سائق)', role: 'driver', isOnline: true },
  { id: '2', name: 'عمر (منشأة)', role: 'company', isOnline: true },
  { id: '3', name: 'مسؤول النظام', role: 'admin', isOnline: false },
  { id: '4', name: 'شركة النقل السريع', role: 'transport', isOnline: true },
  { id: '5', name: 'سائق خالد', role: 'driver', isOnline: true },
];

const generateMockConversation = (user1Id: string, user2Id: string): Conversation => {
  const user1 = mockUsers.find(u => u.id === user1Id)!;
  const user2 = mockUsers.find(u => u.id === user2Id)!;
  const conversationId = `conv-${user1Id}-${user2Id}`;

  return {
    id: conversationId,
    participants: [user1Id, user2Id],
    messages: [
      {
        id: `msg-${conversationId}-1`,
        senderId: user1Id,
        senderName: user1.name,
        text: 'مرحباً، هل يمكنك تأكيد موعد الالتقاط؟',
        timestamp: new Date(Date.now() - 3600000), // 1 hour ago
        read: true,
      },
      {
        id: `msg-${conversationId}-2`,
        senderId: user2Id,
        senderName: user2.name,
        text: 'أهلاً بك! نعم، تم تأكيد الالتقاط في الساعة 10 صباحاً.',
        timestamp: new Date(Date.now() - 3500000), // 58 mins ago
        read: false,
      },
    ],
    lastMessageTimestamp: new Date(Date.now() - 3500000),
    unreadCount: 1,
  };
};

export const useChatStore = create<ChatState>((set, get) => ({
  users: mockUsers,
  conversations: [
    generateMockConversation('1', '2'), // Driver Ahmed with Company Omar
    generateMockConversation('2', '4'), // Company Omar with Transport Company
    generateMockConversation('1', '4'), // Driver Ahmed with Transport Company
  ],
  activeConversationId: null,
  isChatOpen: false,

  sendMessage: (conversationId, text) => {
    const currentUser = useAuthStore.getState().user;
    if (!currentUser) return;

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      senderId: currentUser.id,
      senderName: currentUser.name,
      text,
      timestamp: new Date(),
      read: true, // Sender always reads their own message
    };

    set((state) => {
      const updatedConversations = state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: [...conv.messages, newMessage],
              lastMessageTimestamp: newMessage.timestamp,
              // Increment unread count for other participants
              unreadCount: conv.unreadCount + conv.participants.filter(pId => pId !== currentUser.id).length,
            }
          : conv
      );
      return { conversations: updatedConversations };
    });

    // Simulate recipient receiving the message after a delay
    const conversation = get().conversations.find(c => c.id === conversationId);
    if (conversation) {
      const otherParticipants = conversation.participants.filter(pId => pId !== currentUser.id);
      otherParticipants.forEach(pId => {
        setTimeout(() => {
          get()._receiveMessage(conversationId, pId, `رد على: "${text.substring(0, 20)}..."`);
        }, 2000 + Math.random() * 3000); // 2-5 second delay
      });
    }
  },

  startNewConversation: (participantIds) => {
    const currentUser = useAuthStore.getState().user;
    if (!currentUser) return '';

    const allParticipantIds = [...new Set([...participantIds, currentUser.id])].sort();
    
    // Check if conversation already exists
    const existingConv = get().conversations.find(conv =>
      conv.participants.length === allParticipantIds.length &&
      conv.participants.every(pId => allParticipantIds.includes(pId))
    );

    if (existingConv) {
      get().setActiveConversation(existingConv.id);
      return existingConv.id;
    }

    const newConversation: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      participants: allParticipantIds,
      messages: [],
      lastMessageTimestamp: new Date(),
      unreadCount: 0,
    };

    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: newConversation.id,
    }));
    return newConversation.id;
  },

  setActiveConversation: (conversationId) => {
    set({ activeConversationId: conversationId });
    if (conversationId) {
      get().markMessagesAsRead(conversationId);
    }
  },

  markMessagesAsRead: (conversationId) => {
    const currentUser = useAuthStore.getState().user;
    if (!currentUser) return;

    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: conv.messages.map((msg) =>
                msg.senderId !== currentUser.id ? { ...msg, read: true } : msg
              ),
              unreadCount: 0,
            }
          : conv
      ),
    }));
  },

  toggleChat: () => set((state) => ({ isChatOpen: !state.isChatOpen })),

  // Mock function to simulate receiving a message from another user
  _receiveMessage: (conversationId, senderId, text) => {
    const sender = get().users.find(u => u.id === senderId);
    if (!sender) return;

    const currentUser = useAuthStore.getState().user;
    const isChatActive = get().activeConversationId === conversationId && get().isChatOpen;

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      senderId,
      senderName: sender.name,
      text,
      timestamp: new Date(),
      read: isChatActive, // Mark as read if chat is open and active
    };

    set((state) => {
      const updatedConversations = state.conversations.map((conv) =>
        conv.id === conversationId
          ? {
              ...conv,
              messages: [...conv.messages, newMessage],
              lastMessageTimestamp: newMessage.timestamp,
              unreadCount: isChatActive ? 0 : conv.unreadCount + 1,
            }
          : conv
      );
      return { conversations: updatedConversations };
    });

    // Send a notification if the chat is not open or not active
    if (!isChatActive && currentUser) {
      useNotificationStore.getState().addNotification({
        type: 'info',
        priority: 'medium',
        title: `رسالة جديدة من ${sender.name}`,
        titleEn: `New message from ${sender.name}`,
        message: text,
        messageEn: text, // For simplicity, using same text for En
        role: currentUser.role,
        autoHide: true,
        duration: 5000,
      });
    }
  },

  _simulateTyping: (conversationId, userId) => {
    // This would typically update a 'isTyping' status in the UI
    console.log(`${userId} is typing in ${conversationId}...`);
  },
}));
