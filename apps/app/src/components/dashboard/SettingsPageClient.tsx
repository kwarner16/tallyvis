"use client";

import { useState } from "react";
import type { Business } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { updateBusinessAction } from "@/lib/businessActions";

export function SettingsPageClient({ initialBusiness }: { initialBusiness: Business }) {
  const [business, setBusiness] = useState(initialBusiness);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await updateBusinessAction({
        name: business.name,
        email: business.email,
        phone: business.phone,
        serviceArea: business.serviceArea,
        logoUrl: business.logoUrl?.trim() || undefined,
        brandColor: business.brandColor?.trim() || undefined,
      });
      setBusiness(saved);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Business settings
        </h1>
        <p className="text-ink-soft">Basic information about your business.</p>
      </div>

      {justSaved ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          Settings saved.
        </p>
      ) : null}
      {saveError ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 sm:max-w-lg">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Business name</span>
          <input
            type="text"
            value={business.name}
            onChange={(e) => setBusiness({ ...business, name: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Business email</span>
          <input
            type="email"
            value={business.email}
            onChange={(e) => setBusiness({ ...business, email: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Phone</span>
          <input
            type="tel"
            value={business.phone}
            onChange={(e) => setBusiness({ ...business, phone: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Service area</span>
          <input
            type="text"
            value={business.serviceArea}
            onChange={(e) => setBusiness({ ...business, serviceArea: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">
            Logo URL <span className="font-normal text-ink-faint">(optional)</span>
          </span>
          <input
            type="url"
            value={business.logoUrl ?? ""}
            onChange={(e) => setBusiness({ ...business, logoUrl: e.target.value })}
            placeholder="https://yourwebsite.com/logo.png"
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
          <span className="text-xs text-ink-faint">
            A hosted image URL — shown on your public estimator and quote pages.
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">
            Brand color <span className="font-normal text-ink-faint">(optional)</span>
          </span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(business.brandColor ?? "") ? business.brandColor! : "#2563eb"}
              onChange={(e) => setBusiness({ ...business, brandColor: e.target.value })}
              className="h-9 w-12 rounded border border-line bg-paper"
            />
            <input
              type="text"
              value={business.brandColor ?? ""}
              onChange={(e) => setBusiness({ ...business, brandColor: e.target.value })}
              placeholder="#2563eb"
              className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
            />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Default industry</span>
          <input
            type="text"
            value="Window Cleaning"
            disabled
            className="rounded-lg border border-line bg-paper-alt px-3 py-2 text-sm text-ink-faint"
          />
          <span className="text-xs text-ink-faint">
            More industries are planned — see the Industries section on the marketing site.
          </span>
        </label>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={buttonVariants({ variant: "primary", className: "self-start" })}
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>
    </div>
  );
}
