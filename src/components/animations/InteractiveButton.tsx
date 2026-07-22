import { motion } from 'framer-motion';
import { Button, ButtonProps } from '../ui/button';
import { ReactNode } from 'react';

// CP7 focus-ring audit finding: motion.div wrapping <Button> (the previous
// shape here) auto-adds tabindex="0" to itself the moment it receives
// whileHover/whileTap props — framer-motion makes any element with a tap
// gesture keyboard-interactive. That inserted a SECOND, unstyled,
// non-semantic (no role="button") tab stop ahead of the real <button>,
// so keyboard users landed on a bare div with only the browser's weak
// default outline, never the button's actual focus-visible ring. Verified
// with Playwright: Tab from the last field landed on
// `<div tabindex="0"><button>...</button></div>` with the div, not the
// button, as document.activeElement.
//
// Fix: animate the button element itself (motion(Button), forwardRef-
// compatible) instead of wrapping it in an extra div — there is then only
// one focusable node, and it's the real, properly-labeled, ring-styled
// <button>.
const MotionButton = motion(Button);

// framer-motion's MotionProps redefines onDrag/onDragStart/onDragEnd/
// onAnimationStart/onAnimationEnd with its own (gesture-info) signatures,
// which collide with the native DOM event handler signatures ButtonProps
// inherits from React.ButtonHTMLAttributes — the standard, documented
// friction point when wrapping a native-element component with motion().
// None of these are used on any button in this app; omitting them from the
// prop type (not from the DOM — native drag/animation events still fire
// normally) is the standard fix.
type NativeDragAnimationHandlers =
  | 'onDrag' | 'onDragStart' | 'onDragEnd'
  | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration';

interface InteractiveButtonProps extends Omit<ButtonProps, NativeDragAnimationHandlers> {
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
  className,
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
    <MotionButton
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={handleClick}
      className={`transition-all duration-200 ${className ?? ''}`}
      {...props}
    >
      {children}
    </MotionButton>
  );
}
