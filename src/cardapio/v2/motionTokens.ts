/**
 * KÔMA Cardápio Universal — Motion Design System
 *
 * Physics-driven springs & easing curves tuned for 60 FPS GPU-composited
 * properties (transform & opacity only). Always paired with
 * <MotionConfig reducedMotion="user">.
 */

export const KOMA_SPRING_NAV = {
  type: "spring" as const,
  stiffness: 440,
  damping: 32,
  mass: 0.8,
};

export const KOMA_SPRING_BUBBLE = {
  type: "spring" as const,
  stiffness: 300,
  damping: 21,
  mass: 0.85,
};

export const KOMA_SPRING_TAP = {
  type: "spring" as const,
  stiffness: 520,
  damping: 28,
};

export const KOMA_SPRING_SHEET = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
  mass: 0.9,
};

export const KOMA_EASE_SMOOTH = [0.22, 1, 0.36, 1] as const;

export const KOMA_FADE_UP = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.22, ease: KOMA_EASE_SMOOTH },
};
