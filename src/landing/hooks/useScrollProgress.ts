import { useScroll, type MotionValue } from 'motion/react';
import { useRef, type RefObject } from 'react';

interface ScrollProgressResult {
  ref: RefObject<HTMLElement | null>;
  progress: MotionValue<number>;
}

export function useScrollProgress(
  offset: [string, string] = ['start end', 'end start']
): ScrollProgressResult {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: offset as any,
  });
  return { ref, progress: scrollYProgress };
}

export function useStickyScrollProgress(): ScrollProgressResult {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start start', 'end end'],
  });
  return { ref, progress: scrollYProgress };
}
