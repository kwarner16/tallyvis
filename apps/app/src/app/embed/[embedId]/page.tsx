"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { persistEmbedId } from "@/lib/estimator/EstimatorContext";
import { verifyEmbedIdAction } from "@/lib/publicActions";

/**
 * Phase 14 — the website-embed entry point (see
 * docs/decisions/0016-onboarding-billing-embed.md). `embed.js` (see
 * public/embed.js) points its iframe's `src` here. This page does exactly
 * two things: verifies the embed id resolves to a real business (so a
 * typo'd/stale embed snippet fails fast, right here, instead of silently
 * breaking several steps into the wizard), then persists it and redirects
 * into the SAME `/estimate/property` wizard the marketing site's own bare
 * estimator already uses — nothing about the wizard itself is duplicated
 * or forked for embed use.
 */
export default function EmbedLandingPage({ params }: { params: Promise<{ embedId: string }> }) {
  const { embedId } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "invalid">("checking");

  useEffect(() => {
    let cancelled = false;
    verifyEmbedIdAction(embedId).then((valid) => {
      if (cancelled) return;
      if (!valid) {
        setStatus("invalid");
        return;
      }
      persistEmbedId(embedId);
      router.replace("/estimate/property");
    });
    return () => {
      cancelled = true;
    };
  }, [embedId, router]);

  if (status === "invalid") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-ink">This estimator isn&rsquo;t set up correctly.</p>
        <p className="text-xs text-ink-faint">Contact the business directly for a quote.</p>
      </div>
    );
  }

  return null;
}
