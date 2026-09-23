"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { PublicQuoteView } from "@tallyvis/api";
import {
  acceptPublicQuoteAction,
  declinePublicQuoteAction,
  getPublicQuoteByTokenAction,
  requestPublicQuoteChangesAction,
} from "@/lib/publicActions";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { CustomerQuoteView, type CustomerQuoteActions } from "@/components/quote/CustomerQuoteView";

/**
 * The real, secured customer-facing quote view (Phase 10 — see
 * docs/decisions/0012-secure-quote-sharing.md). `[token]` is a share token,
 * not a database id: possession of it is the entire access credential,
 * resolved server-side by `getPublicQuoteByTokenAction`. There is no
 * business/customer authentication here by design — a customer never
 * signs in — but an unknown, revoked, or expired token now resolves to
 * nothing at all, unlike the Phase 8/9 placeholder this route replaces.
 */
export default function CustomerQuotePage() {
  const params = useParams<{ token: string }>();
  const token = Array.isArray(params.token) ? params.token[0]! : params.token;

  const [data, setData] = useState<PublicQuoteView | null | undefined>(undefined);
  const [pending, setPending] = useState<CustomerQuoteActions["pending"]>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(() => {
    getPublicQuoteByTokenAction(token).then(setData);
  }, [token]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function handleAccept() {
    setPending("accept");
    setActionError(null);
    const result = await acceptPublicQuoteAction(token);
    if (result.ok) {
      setData((current) => (current ? { ...current, quote: result.data } : current));
    } else {
      setActionError(result.message);
    }
    setPending(null);
  }

  async function handleDecline() {
    setPending("decline");
    setActionError(null);
    const result = await declinePublicQuoteAction(token);
    if (result.ok) {
      setData((current) => (current ? { ...current, quote: result.data } : current));
    } else {
      setActionError(result.message);
    }
    setPending(null);
  }

  async function handleRequestChanges(note: string) {
    setPending("request-changes");
    setActionError(null);
    const result = await requestPublicQuoteChangesAction(token, note);
    if (result.ok) {
      setData((current) => (current ? { ...current, quote: result.data } : current));
    } else {
      setActionError(result.message);
    }
    setPending(null);
  }

  if (data === undefined) return null;

  if (data === null) {
    return (
      <EmptyState
        heading="We couldn't find this estimate."
        description="This link may be incorrect, expired, or no longer active. Please check with the business that sent it to you."
      />
    );
  }

  return (
    <CustomerQuoteView
      quote={data.quote}
      business={data.business}
      expiresAt={data.expiresAt}
      actions={{
        onAccept: handleAccept,
        onDecline: handleDecline,
        onRequestChanges: handleRequestChanges,
        pending,
        error: actionError,
      }}
    />
  );
}
