import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface MovingTruckAnimationProps {
  className?: string;
  truckColor?: string;
}

export default function MovingTruckAnimation({
  className,
  truckColor = 'hsl(var(--primary))',
}: MovingTruckAnimationProps) {
  const truckWidth = 100; // Approximate width of the SVG truck
  const animationDuration = 15; // Adjust duration for speed

  return (
    <div className={cn("relative w-screen h-10 overflow-hidden", className)}>
      <motion.div
        className="absolute"
        initial={{ x: `-${truckWidth}px` }} // Start off-screen left by truck's width
        animate={{ x: `calc(100vw + ${truckWidth}px)` }} // Move to off-screen right by viewport width + truck's width
        transition={{
          duration: animationDuration,
          ease: 'linear',
          repeat: Infinity,
          repeatType: 'loop',
        }}
      >
        <svg
          width={truckWidth}
          height="35"
          viewBox="0 0 100 35"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Main compactor body */}
          <rect x="0" y="5" width="70" height="25" rx="4" fill={truckColor} />
          {/* Compactor rear mechanism - simplified */}
          <path d="M65 5L75 0L75 30L65 25V5Z" fill={truckColor} opacity="0.8" />
          <rect x="70" y="5" width="10" height="20" rx="2" fill={truckColor} opacity="0.6" /> {/* Rear door/panel */}

          {/* Cabin */}
          <rect x="70" y="5" width="30" height="20" rx="4" fill={truckColor} />
          {/* Window */}
          <rect x="75" y="8" width="18" height="14" rx="2" fill="white" opacity="0.8" />

          {/* Wheels */}
          <circle cx="18" cy="32" r="5" fill="black" />
          <circle cx="55" cy="32" r="5" fill="black" />
          <circle cx="85" cy="32" r="5" fill="black" />
        </svg>
      </motion.div>
    </div>
  );
}
