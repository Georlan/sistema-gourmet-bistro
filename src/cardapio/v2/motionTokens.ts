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
