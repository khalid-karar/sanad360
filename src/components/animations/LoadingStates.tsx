import { motion } from 'framer-motion';
import { LoadingSpinner } from '../ui/loading-spinner';
import { Skeleton } from '../ui/skeleton';
import { useAuthStore } from '../../stores/authStore';

interface LoadingStatesProps {
  type?: 'spinner' | 'skeleton' | 'dots' | 'pulse';
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  className?: string;
}

export default function LoadingStates({ 
  type = 'spinner', 
  size = 'md', 
  text,
  className 
}: LoadingStatesProps) {
  const { isRTL } = useAuthStore();

  if (type === 'skeleton') {
    return (
      <div className={`space-y-4 ${className}`}>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-32 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="h-10 w-20" />
        </div>
      </div>
    );
  }

  if (type === 'dots') {
    return (
      <div className={`flex items-center justify-center gap-2 ${className}`}>
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 bg-primary rounded-full"
            animate={{
              scale: [1, 1.2, 1],
              opacity: [0.5, 1, 0.5]
            }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.2
            }}
          />
        ))}
        {text && (
          <span className="ml-3 text-sm text-muted-foreground">{text}</span>
        )}
      </div>
    );
  }

  if (type === 'pulse') {
    return (
      <motion.div
        className={`flex items-center justify-center ${className}`}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
          <div className="w-8 h-8 bg-primary rounded-full" />
        </div>
        {text && (
          <span className="ml-3 text-sm text-muted-foreground">{text}</span>
        )}
      </motion.div>
    );
  }

  return (
    <div className={`flex items-center justify-center gap-3 ${className}`}>
      <LoadingSpinner size={size} />
      {text && (
        <span className="text-sm text-muted-foreground">{text}</span>
      )}
    </div>
  );
}
