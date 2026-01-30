"use strict";

import { motion, Variants } from "framer-motion";
import { useMemo, FC } from "preact/compat";
import { cn } from "@/lib/utils";

type AnimationType = "blurInUp" | "fadeIn" | "slideUp" | "scaleIn";

interface TextAnimateProps {
  children: string;
  className?: string;
  animation?: AnimationType;
  by?: "word" | "character" | "line";
  once?: boolean;
  delay?: number;
  duration?: number;
}

const animationVariants: Record<AnimationType, Variants> = {
  blurInUp: {
    hidden: { filter: "blur(10px)", opacity: 0, y: 20 },
    visible: { filter: "blur(0px)", opacity: 1, y: 0 },
  },
  fadeIn: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  slideUp: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  },
  scaleIn: {
    hidden: { opacity: 0, scale: 0.8 },
    visible: { opacity: 1, scale: 1 },
  },
};

export const TextAnimate: FC<TextAnimateProps> = ({
  children,
  className,
  animation = "blurInUp",
  by = "character",
  once = true,
  delay = 0,
  duration = 0.5,
}) => {
  const words = useMemo(() => {
    if (by === "line") return children.split("\n");
    if (by === "word") return children.split(" ");
    return children.split("");
  }, [children, by]);

  const containerVariants: Variants = {
    hidden: {},
    visible: {
      transition: {
        staggerChildren: 0.05,
        delayChildren: delay,
      },
    },
  };

  const itemVariants = animationVariants[animation];

  return (
    <motion.span
      className={cn("inline-block", className)}
      variants={containerVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once }}
    >
      {words.map((word, i) => (
        <motion.span
          key={i}
          className="inline-block"
          variants={itemVariants}
          transition={{ duration }}
          style={by === "word" ? { marginRight: "0.25em" } : {}}
        >
          {word === " " ? "\u00A0" : word}
        </motion.span>
      ))}
    </motion.span>
  );
};
