import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface EyebrowProps extends HTMLAttributes<HTMLParagraphElement> {
  children: ReactNode;
}

export function Eyebrow({ children, className, ...props }: EyebrowProps) {
  return (
    <p
      className={cn(
        "text-xs font-semibold uppercase tracking-[0.2em] text-accent-strong",
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
