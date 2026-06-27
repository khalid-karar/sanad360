import { motion } from 'framer-motion';
import { Button, ButtonProps } from '../ui/button';
import { ReactNode } from 'react';

interface InteractiveButtonProps extends ButtonProps {
  children: ReactNode;
  hapticFeedback?: boolean;
  soundFeedback?: boolean;
}

export default function InteractiveButton({ 
  children, 
  hapticFeedback = false,
  soundFeedback = false,
  onClick,
  ...props 
}: InteractiveButtonProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Haptic feedback for mobile devices
    if (hapticFeedback && 'vibrate' in navigator) {
      navigator.vibrate(10);
    }

    // Sound feedback
    if (soundFeedback) {
      const audio = new Audio('/click-sound.mp3');
      audio.volume = 0.1;
      audio.play().catch(() => {
        // Ignore if sound fails to play
      });
    }

    if (onClick) {
      onClick(e);
    }
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
    >
      <Button
        onClick={handleClick}
        {...props}
        className={`transition-all duration-200 ${props.className}`}
      >
        {children}
      </Button>
    </motion.div>
  );
}
