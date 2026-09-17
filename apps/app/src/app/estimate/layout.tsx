import type { ReactNode } from "react";
import { EstimatorProvider } from "@/lib/estimator/EstimatorContext";
import { StepShell } from "@/components/StepShell";

export default function EstimateLayout({ children }: { children: ReactNode }) {
  return (
    <EstimatorProvider>
      <StepShell>{children}</StepShell>
    </EstimatorProvider>
  );
}
