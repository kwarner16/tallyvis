"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Business } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { deriveEstimatorTheme, normalizeHexColor } from "@tallyvis/config";
import { updateBusinessAction } from "@/lib/businessActions";

export function SettingsPageClient({ initialBusiness }: { initialBusiness: Business }) {
  const [business, setBusiness] = useState(initialBusiness);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** Live, unsaved preview of the estimator theme this brand color would produce — see @tallyvis/config's deriveEstimatorTheme, the same function the estimator itself uses. `null` while the typed value isn't yet a valid six-digit hex, so the preview falls back to the neutral default rather than showing something misleading. */
  const previewTheme = useMemo(() => deriveEstimatorTheme(business.brandColor), [business.brandColor]);
  const isValidBrandColor = normalizeHexColor(business.brandColor) !== null;

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
          {business.brandColor && !isValidBrandColor ? (
            <span className="text-xs text-red-600">
              Enter a six-digit hex value, like #0057B8 — this won&rsquo;t save until it&rsquo;s valid.
            </span>
          ) : (
            <span className="text-xs text-ink-faint">
              Used to theme your public estimator — buttons, progress steps, and links. Leave blank for
              the default Tallyvis look.
            </span>
          )}
          {previewTheme ? (
            <div
              style={previewTheme as CSSProperties}
              className="mt-1 flex items-center gap-3 rounded-xl border border-line bg-paper-alt p-3"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-strong text-[11px] font-medium text-accent-foreground">
                1
              </span>
              <button
                type="button"
                tabIndex={-1}
                className={buttonVariants({ variant: "primary", className: "pointer-events-none px-4 py-2 text-xs" })}
              >
                Get an estimate
              </button>
              <span className="text-xs font-medium text-accent-strong underline underline-offset-2">
                Preview link
              </span>
            </div>
          ) : null}
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
