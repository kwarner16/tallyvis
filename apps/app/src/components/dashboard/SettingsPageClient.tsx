"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { Business } from "@tallyvis/types";
import { buttonVariants } from "@tallyvis/ui";
import { deriveEstimatorTheme, normalizeHexColor } from "@tallyvis/config";
import { updateBusinessAction, updateSmsNotificationSettingsAction } from "@/lib/businessActions";

export function SettingsPageClient({
  initialBusiness,
  smsSendingActive,
}: {
  initialBusiness: Business;
  /** Whether a real SMS could currently be sent (real provider configured AND the A2P 10DLC campaign-approval gate is open — see services/api's notifications/sms/index.ts). `false` until the campaign is approved, even if a business turns this setting on. */
  smsSendingActive: boolean;
}) {
  const [business, setBusiness] = useState(initialBusiness);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [smsEnabled, setSmsEnabled] = useState(initialBusiness.smsNotificationsEnabled);
  const [notificationPhone, setNotificationPhone] = useState(initialBusiness.notificationPhone ?? "");
  const [smsSaving, setSmsSaving] = useState(false);
  const [smsJustSaved, setSmsJustSaved] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  async function handleSaveSms() {
    setSmsSaving(true);
    setSmsError(null);
    const result = await updateSmsNotificationSettingsAction({
      enabled: smsEnabled,
      notificationPhone: notificationPhone.trim() || undefined,
    });
    if (result.ok) {
      setSmsEnabled(result.data.smsNotificationsEnabled);
      setNotificationPhone(result.data.notificationPhone ?? "");
      setSmsJustSaved(true);
      setTimeout(() => setSmsJustSaved(false), 2500);
    } else {
      setSmsError(result.message);
    }
    setSmsSaving(false);
  }

  /** Live, unsaved preview of the estimator theme this brand color would produce — see @tallyvis/config's deriveEstimatorTheme, the same function the estimator itself uses. `null` while the typed value isn't yet a valid six-digit hex, so the preview falls back to the neutral default rather than showing something misleading. */
  const previewTheme = useMemo(() => deriveEstimatorTheme(business.brandColor), [business.brandColor]);
  const isValidBrandColor = normalizeHexColor(business.brandColor) !== null;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    const result = await updateBusinessAction({
      name: business.name,
      email: business.email,
      phone: business.phone,
      serviceArea: business.serviceArea,
      logoUrl: business.logoUrl?.trim() || undefined,
      brandColor: business.brandColor?.trim() || undefined,
    });
    if (result.ok) {
      setBusiness(result.data);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } else {
      setSaveError(result.message);
    }
    setSaving(false);
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

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 sm:max-w-lg">
        <div>
          <h2 className="text-lg font-semibold text-ink">SMS notifications</h2>
          <p className="text-sm text-ink-soft">
            Get a text as soon as a customer submits a quote through your estimator — handy for
            checking new leads from your phone between jobs.
          </p>
        </div>

        {!smsSendingActive ? (
          <p className="rounded-lg border border-line bg-paper-alt px-3 py-2 text-sm text-ink-soft">
            SMS notifications aren&rsquo;t sending yet — TallyVis&rsquo;s SMS program is still
            pending carrier approval. You can save your settings now and texts will start
            automatically once it&rsquo;s approved; in the meantime, new quotes still appear on
            your dashboard right away.
          </p>
        ) : null}

        {smsJustSaved ? (
          <p className="rounded-lg border border-accent bg-accent-soft px-3 py-2 text-sm text-accent-strong">
            Saved.
          </p>
        ) : null}
        {smsError ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{smsError}</p>
        ) : null}

        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={smsEnabled}
            onChange={(e) => setSmsEnabled(e.target.checked)}
            className="h-5 w-5 rounded border-line text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
          <span className="text-sm font-medium text-ink">New quote SMS notifications</span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Notification phone number</span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={notificationPhone}
            onChange={(e) => setNotificationPhone(e.target.value)}
            placeholder="(555) 123-4567"
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
          <span className="text-xs text-ink-faint">
            Where alerts are sent — not shown to customers. This can be different from your public
            business phone number above.
          </span>
        </label>

        <button
          type="button"
          onClick={handleSaveSms}
          disabled={smsSaving}
          className={buttonVariants({ variant: "primary", className: "self-start" })}
        >
          {smsSaving ? "Saving…" : "Save SMS settings"}
        </button>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 sm:max-w-lg">
        <div>
          <h2 className="text-lg font-semibold text-ink">Estimator branding</h2>
          <p className="text-sm text-ink-soft">
            Customize how the Tallyvis estimator appears when embedded on your website.
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">
            Logo <span className="font-normal text-ink-faint">(optional)</span>
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
            Primary color <span className="font-normal text-ink-faint">(optional)</span>
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
            {business.brandColor ? (
              <button
                type="button"
                onClick={() => setBusiness({ ...business, brandColor: undefined })}
                className="text-xs font-medium text-ink-faint underline underline-offset-2 hover:text-ink-soft"
              >
                Restore Tallyvis default
              </button>
            ) : null}
          </div>
          {business.brandColor && !isValidBrandColor ? (
            <span className="text-xs text-red-600">
              Enter a six-digit hex value, like #0057B8 — this won&rsquo;t save until it&rsquo;s valid.
            </span>
          ) : (
            <span className="text-xs text-ink-faint">
              Used to theme your public estimator — buttons, progress steps, and links, ONLY when a
              customer reaches it through your embedded widget. The direct Tallyvis estimator (and a
              business with no color set here) always uses Tallyvis&rsquo;s own default look.
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Preview</span>
          <div
            style={(previewTheme ?? undefined) as CSSProperties}
            className="flex items-center gap-3 rounded-xl border border-line bg-paper-alt p-3"
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
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={buttonVariants({ variant: "primary", className: "self-start" })}
        >
          {saving ? "Saving…" : "Save branding"}
        </button>
      </div>
    </div>
  );
}
