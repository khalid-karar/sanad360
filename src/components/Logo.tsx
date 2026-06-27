import React from 'react';
import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string; // For the container div that acts as the viewport
}

export default function Logo({ className }: LogoProps) {
  const logoSrc = "https://c.animaapp.com/mg7ujeibgE7gyO/img/chatgpt-image-oct-1-2025-04_42_05-pm-copy.png"; // New hosted logo URL

  return (
    <div
      className={cn(
        "relative bg-no-repeat bg-contain bg-center", // Use bg-contain and bg-center for the new icon-only image
        className
      )}
      style={{
        backgroundImage: `url(${logoSrc})`,
      }}
      role="img"
      aria-label="Tadweer360 Logo Icon"
    />
  );
}
