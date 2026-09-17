import type { ButtonHTMLAttributes, ReactNode } from "react";
import { buttonVariants, type ButtonVariant } from "./button-variants";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
}

export function Button({ children, className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button className={buttonVariants({ variant, className })} {...props}>
      {children}
    </button>
  );
}
