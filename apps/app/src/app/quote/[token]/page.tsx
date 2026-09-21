"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Business, Quote } from "@tallyvis/types";
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

  const [data, setData] = useState<{ quote: Quote; business: Business; expiresAt: string } | null | undefined>(
    undefined,
  );
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
    try {
      const quote = await acceptPublicQuoteAction(token);
      setData((current) => (current ? { ...current, quote } : current));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not accept this quote.");
    } finally {
      setPending(null);
    }
  }

  async function handleDecline() {
    setPending("decline");
    setActionError(null);
    try {
      const quote = await declinePublicQuoteAction(token);
      setData((current) => (current ? { ...current, quote } : current));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not decline this quote.");
    } finally {
      setPending(null);
    }
  }

  async function handleRequestChanges(note: string) {
    setPending("request-changes");
    setActionError(null);
    try {
      const quote = await requestPublicQuoteChangesAction(token, note);
      setData((current) => (current ? { ...current, quote } : current));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not send your request.");
    } finally {
      setPending(null);
    }
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
