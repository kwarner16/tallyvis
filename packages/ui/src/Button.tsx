import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/**
 * Placeholder shared component proving the packages/ui -> apps/web wiring
 * works end to end. Real Tallyvis brand components (see docs/product for the
 * visual direction) are built in Phase 2.
 */
export function Button({ children, className, ...props }: ButtonProps) {
  const base = "rounded-md px-4 py-2 font-medium transition-colors";
  const classes = className ? `${base} ${className}` : `${base} bg-neutral-900 text-white`;

  return (
    <button className={classes} {...props}>
      {children}
    </button>
  );
}
