import type { AnalysisStage } from "./types";

export interface AnalysisStatusProps {
  status: string | null;
  stage: AnalysisStage;
}

export function AnalysisStatus({ status, stage }: AnalysisStatusProps) {
  if (!status) return null;

  return (
    <div
      key={status}
      role="status"
      className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-xs font-medium text-ink-soft"
      style={{ animation: "fade-in 0.3s ease-out" }}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full bg-accent ${stage === "analyzing" ? "animate-pulse" : ""}`}
      />
      {status}
    </div>
  );
}
