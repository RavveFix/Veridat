"use strict";

import { useEffect, useState, useRef } from "preact/hooks";
import { useInView } from "framer-motion";
import { cn } from "@/lib/utils";

interface TypingAnimationProps {
  children: string;
  className?: string;
  duration?: number;
  delay?: number;
  startOnView?: boolean;
}

export function TypingAnimation({
  children,
  className,
  duration = 100,
  delay = 0,
  startOnView = false,
}: TypingAnimationProps) {
  const [displayedText, setDisplayedText] = useState<string>("");
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });

  useEffect(() => {
    if (startOnView && !isInView) return;

    setDisplayedText("");
    
    const timeout = setTimeout(() => {
      const chars = Array.from(children);
      let currentI = 0;
      const interval = setInterval(() => {
        if (currentI < chars.length) {
          setDisplayedText(chars.slice(0, currentI + 1).join(""));
          currentI++;
        } else {
          clearInterval(interval);
        }
      }, duration);
      
      return () => clearInterval(interval);
    }, delay);

    return () => clearTimeout(timeout);
  }, [children, duration, delay, isInView, startOnView]);

  return (
    <span ref={ref} className={cn(className)}>
      {displayedText}
    </span>
  );
}
