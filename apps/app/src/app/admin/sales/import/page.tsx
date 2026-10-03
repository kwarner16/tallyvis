import Link from "next/link";
import { ImportPreviewClient } from "@/components/admin/sales/ImportPreviewClient";
import { requireAdminContext } from "@/lib/adminSession";

export default async function AdminSalesImportPage() {
  await requireAdminContext();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/sales" className="text-xs font-medium text-ink-faint hover:text-ink-soft">
          ← Sales
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Import prospects</h1>
        <p className="text-ink-soft">
          Paste a list from ChatGPT or a spreadsheet — Business Name, Owner, Phone, Email, Website, City, State, Source. Not every
          column is required; at minimum a usable prospect needs a business name and phone number.
        </p>
      </div>

      <ImportPreviewClient />
    </div>
  );
}
