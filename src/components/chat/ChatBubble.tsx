import React from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore } from '../../stores/chatStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageSquareIcon, XIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import ChatWindow from './ChatWindow';

export default function ChatBubble() {
  const { isRTL, user } = useAuthStore();
  const { isChatOpen, toggleChat, conversations } = useChatStore();

  // Calculate total unread messages for the current user
  const totalUnread = conversations.reduce((sum, conv) => {
    const currentUserIsParticipant = conv.participants.includes(user?.id || '');
    const hasUnreadForCurrentUser = conv.messages.some(
      msg => msg.senderId !== user?.id && !msg.read
    );
    return sum + (currentUserIsParticipant && hasUnreadForCurrentUser ? conv.unreadCount : 0);
  }, 0);

  return (
    <>
      <motion.div
        className="fixed bottom-4 right-4 z-50"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Button
          variant="default"
          size="icon-lg"
          onClick={toggleChat}
          className="relative bg-primary text-primary-foreground rounded-full shadow-lg hover:bg-primary/90"
        >
          {isChatOpen ? (
            <XIcon className="w-6 h-6" />
          ) : (
            <MessageSquareIcon className="w-6 h-6" />
          )}
          {totalUnread > 0 && !isChatOpen && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-6 w-6 flex items-center justify-center text-xs p-0 min-w-[24px] rounded-full"
            >
              {totalUnread > 99 ? '99+' : totalUnread}
            </Badge>
          )}
        </Button>
      </motion.div>

      <ChatWindow isOpen={isChatOpen} onClose={toggleChat} />
    </>
  );
}
