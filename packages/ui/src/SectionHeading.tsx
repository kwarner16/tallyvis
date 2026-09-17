import type { ReactNode } from "react";
import { cn } from "./cn";
import { Eyebrow } from "./Eyebrow";

export interface SectionHeadingProps {
  eyebrow?: string;
  heading: ReactNode;
  description?: ReactNode;
  tone?: "light" | "dark";
  align?: "left" | "center";
  className?: string;
}

export function SectionHeading({
  eyebrow,
  heading,
  description,
  tone = "light",
  align = "left",
  className,
}: SectionHeadingProps) {
  const isDark = tone === "dark";

  return (
    <div
      className={cn(
        "flex max-w-2xl flex-col gap-4",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {eyebrow ? <Eyebrow className={isDark ? "text-accent" : undefined}>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          "text-3xl font-semibold tracking-tight sm:text-4xl",
          isDark ? "text-paper" : "text-ink",
        )}
      >
        {heading}
      </h2>
      {description ? (
        <p className={cn("text-lg leading-relaxed", isDark ? "text-paper/70" : "text-ink-soft")}>
          {description}
        </p>
      ) : null}
    </div>
  );
}
