"use client";

import { useEffect, useState } from "react";
import { buttonVariants } from "@tallyvis/ui";
import {
  getBusinessSettings,
  saveBusinessSettings,
  type BusinessSettings,
} from "@/lib/quotes/store";

export default function SettingsPage() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setSettings(getBusinessSettings()));
  }, []);

  if (!settings) return null;

  function handleSave() {
    if (!settings) return;
    saveBusinessSettings(settings);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          Business settings
        </h1>
        <p className="text-ink-soft">Basic information about your business.</p>
      </div>

      <p className="text-xs text-ink-faint">
        Demo data for this prototype — there is no real account/authentication system yet.
      </p>

      {justSaved ? (
        <p className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-sm text-accent-strong">
          Settings saved.
        </p>
      ) : null}

      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-paper p-6 sm:max-w-lg">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Business name</span>
          <input
            type="text"
            value={settings.name}
            onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Business email</span>
          <input
            type="email"
            value={settings.email}
            onChange={(e) => setSettings({ ...settings, email: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Phone</span>
          <input
            type="tel"
            value={settings.phone}
            onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
            className="rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-ink">Service area</span>
          <input
            type="text"
            value={settings.serviceArea}
            onChange={(e) => setSettings({ ...settings, serviceArea: e.target.value })}
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
          className={buttonVariants({ variant: "primary", className: "self-start" })}
        >
          Save settings
        </button>
      </div>
    </div>
  );
}
