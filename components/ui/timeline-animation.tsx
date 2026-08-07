import * as React from "react";
import { motion, Variants } from "motion/react";

interface TimelineContentProps extends React.HTMLAttributes<HTMLElement> {
  as?: "div" | "h1" | "h2" | "h3" | "h4" | "p" | "span" | "section" | "header" | "footer";
  animationNum?: number;
  timelineRef?: React.RefObject<HTMLElement | null>;
  customVariants?: Variants;
  children?: React.ReactNode;
}

export function TimelineContent({
  as = "div",
  animationNum = 0,
  timelineRef,
  customVariants,
  className,
  children,
  ...props
}: TimelineContentProps) {
  const Component = (motion[as as keyof typeof motion] || motion.div) as React.ElementType;

  const defaultVariants: Variants = {
    visible: (i: number) => ({
      y: 0,
      opacity: 1,
      filter: "blur(0px)",
      transition: {
        delay: i * 0.4,
        duration: 0.5,
      },
    }),
    hidden: {
      filter: "blur(10px)",
      y: -20,
      opacity: 0,
    },
  };

  const variants = customVariants || defaultVariants;

  return (
    <Component
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.2 }}
      custom={animationNum}
      variants={variants}
      className={className}
      {...props}
    >
      {children}
    </Component>
  );
}
