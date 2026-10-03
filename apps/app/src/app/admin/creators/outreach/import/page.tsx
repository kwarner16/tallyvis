import Link from "next/link";
import { CreatorOutreachImportPreviewClient } from "@/components/admin/creatorOutreach/CreatorOutreachImportPreviewClient";
import { requireAdminContext } from "@/lib/adminSession";

export default async function AdminCreatorOutreachImportPage() {
  await requireAdminContext();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/creators/outreach" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
          ← Creator Outreach
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Import creator prospects</h1>
        <p className="text-ink-soft">
          Paste a researched list from ChatGPT or a spreadsheet — Creator Name, Contact Name, Email, Primary Platform, Profile URL,
          Other Platforms, Niche, Followers, Source. Not every column is required; at minimum a usable prospect needs a creator
          name and either an email or a profile URL.
        </p>
      </div>

      <CreatorOutreachImportPreviewClient />
    </div>
  );
}
