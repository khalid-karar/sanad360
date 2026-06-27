import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useChatStore, ChatUser, Conversation } from '../../stores/chatStore';
import { Button } from '@/components/ui/button';
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  XIcon, SendIcon, UserIcon, ChevronLeftIcon, CircleDotIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface ChatWindowProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChatWindow({ isOpen, onClose }: ChatWindowProps) {
  const { isRTL, user } = useAuthStore();
  const {
    users,
    conversations,
    activeConversationId,
    sendMessage,
    setActiveConversation,
    markMessagesAsRead,
    startNewConversation,
  } = useChatStore();

  const [messageInput, setMessageInput] = useState('');
  const [showConversationList, setShowConversationList] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentUser = user;
  const activeConversation = conversations.find(conv => conv.id === activeConversationId);

  useEffect(() => {
    if (activeConversationId && !showConversationList) {
      markMessagesAsRead(activeConversationId);
    }
  }, [activeConversationId, showConversationList, markMessagesAsRead]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length]);

  if (!isOpen) return null;

  const handleSendMessage = () => {
    if (messageInput.trim() && activeConversationId) {
      sendMessage(activeConversationId, messageInput.trim());
      setMessageInput('');
    }
  };

  const getParticipantNames = (conv: Conversation) => {
    const otherParticipants = conv.participants
      .filter(pId => pId !== currentUser?.id)
      .map(pId => users.find(u => u.id === pId)?.name || 'Unknown');
    return otherParticipants.join(', ');
  };

  const getUnreadCountForConversation = (conv: Conversation) => {
    return conv.messages.filter(msg => msg.senderId !== currentUser?.id && !msg.read).length;
  };

  const handleSelectConversation = (convId: string) => {
    setActiveConversation(convId);
    setShowConversationList(false);
  };

  const handleStartNewChat = (targetUser: ChatUser) => {
    if (currentUser) {
      const convId = startNewConversation([targetUser.id]);
      setActiveConversation(convId);
      setShowConversationList(false);
    }
  };

  const chatWindowVariants = {
    hidden: { x: isRTL ? '-100%' : '100%', opacity: 0 },
    visible: { x: '0%', opacity: 1 },
    exit: { x: isRTL ? '-100%' : '100%', opacity: 0 },
  };

  return (
    <motion.div
      className="fixed inset-0 sm:inset-auto sm:bottom-20 sm:right-4 w-full sm:w-96 h-full sm:h-[600px] bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col"
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={chatWindowVariants}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div className="flex items-center gap-3">
          {!showConversationList && (
            <Button variant="ghost" size="icon-sm" onClick={() => setShowConversationList(true)} className="text-muted-foreground hover:text-foreground">
              <ChevronLeftIcon className="w-5 h-5" />
            </Button>
          )}
          <CardTitle className="text-xl text-foreground">
            {showConversationList
              ? (isRTL ? 'المحادثات' : 'Chats')
              : (isRTL ? `محادثة مع ${getParticipantNames(activeConversation!)}` : `Chat with ${getParticipantNames(activeConversation!)}`)
            }
          </CardTitle>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <XIcon className="w-5 h-5" />
        </Button>
      </CardHeader>

      <Separator className="bg-border" />

      <CardContent className="flex-1 p-0 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {showConversationList ? (
            <motion.div
              key="conversationList"
              initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL ? 20 : -20 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col"
            >
              <ScrollArea className="flex-1 p-4">
                <h3 className="text-lg font-semibold text-foreground mb-3">
                  {isRTL ? 'محادثاتي' : 'My Conversations'}
                </h3>
                <div className="space-y-2">
                  {conversations
                    .filter(conv => conv.participants.includes(currentUser?.id || ''))
                    .sort((a, b) => b.lastMessageTimestamp.getTime() - a.lastMessageTimestamp.getTime())
                    .map(conv => (
                      <Button
                        key={conv.id}
                        variant="ghost"
                        className="w-full justify-start h-auto py-3 px-4 rounded-lg transition-all duration-200 flex items-center gap-3"
                        onClick={() => handleSelectConversation(conv.id)}
                      >
                        <UserIcon className="w-5 h-5 text-muted-foreground" />
                        <div className="flex-1 text-left">
                          <p className="font-medium text-foreground">
                            {getParticipantNames(conv)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {conv.messages[conv.messages.length - 1]?.text || (isRTL ? 'لا توجد رسائل' : 'No messages')}
                          </p>
                        </div>
                        {getUnreadCountForConversation(conv) > 0 && (
                          <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-1 rounded-full">
                            {getUnreadCountForConversation(conv)}
                          </span>
                        )}
                      </Button>
                    ))}
                </div>

                <Separator className="my-6" />

                <h3 className="text-lg font-semibold text-foreground mb-3">
                  {isRTL ? 'بدء محادثة جديدة' : 'Start New Chat'}
                </h3>
                <div className="space-y-2">
                  {users
                    .filter(u => u.id !== currentUser?.id)
                    .map(u => (
                      <Button
                        key={u.id}
                        variant="ghost"
                        className="w-full justify-start h-auto py-3 px-4 rounded-lg transition-all duration-200 flex items-center gap-3"
                        onClick={() => handleStartNewChat(u)}
                      >
                        <UserIcon className="w-5 h-5 text-muted-foreground" />
                        <div className="flex-1 text-left">
                          <p className="font-medium text-foreground">{u.name}</p>
                          <p className="text-xs text-muted-foreground">{u.role}</p>
                        </div>
                        {u.isOnline && <CircleDotIcon className="w-3 h-3 text-success" />}
                      </Button>
                    ))}
                </div>
              </ScrollArea>
            </motion.div>
          ) : (
            <motion.div
              key="chatMessages"
              initial={{ opacity: 0, x: isRTL ? -20 : 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: isRTL ? -20 : 20 }}
              transition={{ duration: 0.2 }}
              className="flex-1 flex flex-col"
            >
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-4">
                  {activeConversation?.messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'flex',
                        message.senderId === currentUser?.id ? 'justify-end' : 'justify-start'
                      )}
                    >
                      <div
                        className={cn(
                          'max-w-[70%] p-3 rounded-xl',
                          message.senderId === currentUser?.id
                            ? 'bg-primary text-primary-foreground rounded-br-none'
                            : 'bg-muted text-foreground rounded-bl-none'
                        )}
                      >
                        <p className="font-medium text-sm mb-1">
                          {message.senderId === currentUser?.id ? (isRTL ? 'أنت' : 'You') : message.senderName}
                        </p>
                        <p className="text-sm">{message.text}</p>
                        <span className="text-xs opacity-70 mt-1 block">
                          {message.timestamp.toLocaleTimeString(isRTL ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="p-4 border-t border-border flex items-center gap-2">
                <Input
                  type="text"
                  placeholder={isRTL ? 'اكتب رسالة...' : 'Type a message...'}
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  className="flex-1"
                />
                <Button size="icon" onClick={handleSendMessage} disabled={!messageInput.trim()}>
                  <SendIcon className="w-5 h-5" />
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </motion.div>
  );
}
