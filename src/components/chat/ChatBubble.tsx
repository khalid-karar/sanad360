import { useAuthStore } from '../../stores/authStore';
import { Button } from '@/components/ui/button';
import { MessageSquareIcon } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * AI assistant — DEFERRED ("قريباً / Coming Soon").
 * The chat UI/store remain in the codebase but the entry point is disabled so we
 * do not ship a half-built feature. Re-enable by restoring ChatWindow + toggle.
 */
export default function ChatBubble() {
  const { isRTL } = useAuthStore();

  return (
    <motion.div
      className="fixed bottom-4 right-4 z-50"
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Button
        variant="default"
        size="icon-lg"
        disabled
        title={isRTL ? 'المساعد الذكي — قريباً' : 'AI Assistant — Coming Soon'}
        className="relative bg-primary/60 text-primary-foreground rounded-full shadow-lg cursor-not-allowed"
      >
        <MessageSquareIcon className="w-6 h-6" />
      </Button>
    </motion.div>
  );
}
