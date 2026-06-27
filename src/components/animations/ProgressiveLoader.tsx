import { motion } from 'framer-motion';
import { Progress } from '../ui/progress';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';

interface ProgressiveLoaderProps {
  steps: string[];
  currentStep: number;
  className?: string;
}

export default function ProgressiveLoader({ 
  steps, 
  currentStep, 
  className 
}: ProgressiveLoaderProps) {
  const { isRTL } = useAuthStore();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const targetProgress = ((currentStep + 1) / steps.length) * 100;
    const timer = setTimeout(() => setProgress(targetProgress), 100);
    return () => clearTimeout(timer);
  }, [currentStep, steps.length]);

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-foreground font-medium">
            {isRTL ? 'جاري التحميل...' : 'Loading...'}
          </span>
          <span className="text-muted-foreground">
            {Math.round(progress)}%
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      <div className="space-y-3">
        {steps.map((step, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0.3, x: -20 }}
            animate={{ 
              opacity: index <= currentStep ? 1 : 0.3,
              x: index <= currentStep ? 0 : -20
            }}
            transition={{ duration: 0.3, delay: index * 0.1 }}
            className="flex items-center gap-3"
          >
            <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${
              index < currentStep 
                ? 'bg-success' 
                : index === currentStep 
                ? 'bg-primary animate-pulse' 
                : 'bg-muted-foreground/30'
            }`} />
            <span className={`text-sm transition-colors duration-300 ${
              index <= currentStep ? 'text-foreground' : 'text-muted-foreground'
            }`}>
              {step}
            </span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
