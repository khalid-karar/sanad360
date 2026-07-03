import { motion } from 'framer-motion';
import { Button, ButtonProps } from '../ui/button';
import { ReactNode } from 'react';

interface InteractiveButtonProps extends ButtonProps {
  children: ReactNode;
  hapticFeedback?: boolean;
  /** Kept for API compatibility; the sound asset was never shipped (the
   *  /click-sound.mp3 404 on every tap) and audio-on-tap is poor practice
   *  on field devices anyway. Haptics remain. */
  soundFeedback?: boolean;
}

export default function InteractiveButton({
  children,
  hapticFeedback = false,
  soundFeedback: _soundFeedback = false,
  onClick,
  ...props
}: InteractiveButtonProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Haptic feedback for mobile devices
    if (hapticFeedback && 'vibrate' in navigator) {
      navigator.vibrate(10);
    }

    if (onClick) {
      onClick(e);
    }
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
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
