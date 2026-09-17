import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Container({ children, className, ...props }: ContainerProps) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-6 sm:px-8", className)} {...props}>
      {children}
    </div>
  );
}
