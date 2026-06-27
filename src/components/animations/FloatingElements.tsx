import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface FloatingElementsProps {
  children: ReactNode;
  intensity?: 'subtle' | 'medium' | 'strong';
  className?: string;
}

export default function FloatingElements({ 
  children, 
  intensity = 'subtle',
  className 
}: FloatingElementsProps) {
  const getAnimationProps = () => {
    switch (intensity) {
      case 'subtle':
        return {
          y: [-2, 2, -2],
          transition: { duration: 4, repeat: Infinity, ease: "easeInOut" }
        };
      case 'medium':
        return {
          y: [-5, 5, -5],
          x: [-2, 2, -2],
          transition: { duration: 3, repeat: Infinity, ease: "easeInOut" }
        };
      case 'strong':
        return {
          y: [-8, 8, -8],
          x: [-3, 3, -3],
          rotate: [-1, 1, -1],
          transition: { duration: 2.5, repeat: Infinity, ease: "easeInOut" }
        };
      default:
        return {};
    }
  };

  return (
    <motion.div
      animate={getAnimationProps()}
      className={className}
    >
      {children}
    </motion.div>
  );
}
