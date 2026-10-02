import Link from "next/link";
import { listBusinessesAdmin, type AdminBusinessSortBy, type AdminSortDirection } from "@tallyvis/api";
import { buttonVariants, cn } from "@tallyvis/ui";
import { requireAdminContext } from "@/lib/adminSession";
import { BusinessesTable } from "@/components/admin/BusinessesTable";

const SORT_OPTIONS: AdminBusinessSortBy[] = ["createdAt", "name", "quoteCount"];
const PAGE_SIZE = 25;

function isSortBy(value: string | undefined): value is AdminBusinessSortBy {
  return SORT_OPTIONS.includes(value as AdminBusinessSortBy);
}

/**
 * Server-side search + pagination (see
 * docs/decisions/0035-admin-dashboard.md's "Business Table" section) —
 * businesses is the one table this dashboard expects to genuinely grow
 * into the thousands, so the full set is never loaded into the browser
 * just to filter it. The search box below is a plain GET `<form>`, and
 * every sort/page control is a plain `<Link>` — no client JS, no Server
 * Action, just the URL's own query string driving what this Server
 * Component fetches.
 */
export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string; dir?: string }>;
}) {
  const { db, session } = await requireAdminContext();
  const params = await searchParams;

  const search = params.q?.trim() ?? "";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const sortBy: AdminBusinessSortBy = isSortBy(params.sort) ? params.sort : "createdAt";
  const sortDirection: AdminSortDirection = params.dir === "asc" ? "asc" : "desc";

  const result = await listBusinessesAdmin(db, session, { search, page, pageSize: PAGE_SIZE, sortBy, sortDirection });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  function pageHref(targetPage: number): string {
    const urlParams = new URLSearchParams();
    if (search) urlParams.set("q", search);
    urlParams.set("sort", sortBy);
    urlParams.set("dir", sortDirection);
    urlParams.set("page", String(targetPage));
    return `/admin/businesses?${urlParams.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-strong">TallyVis Admin</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">Businesses</h1>
        <p className="text-ink-soft">{result.total} total</p>
      </div>

      <form method="get" className="flex gap-2">
        <input type="hidden" name="sort" value={sortBy} />
        <input type="hidden" name="dir" value={sortDirection} />
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search by business or owner email"
          className="w-full max-w-sm rounded-lg border border-line bg-paper px-4 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          Search
        </button>
        {search ? (
          <Link href="/admin/businesses" className={buttonVariants({ variant: "outline" })}>
            Clear
          </Link>
        ) : null}
      </form>

      <BusinessesTable rows={result.rows} search={search} sortBy={sortBy} sortDirection={sortDirection} />

      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-ink-soft">
          <span>
            Page {result.page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Link
              href={pageHref(Math.max(1, page - 1))}
              aria-disabled={page <= 1}
              className={cn(buttonVariants({ variant: "outline" }), page <= 1 && "pointer-events-none opacity-50")}
            >
              Previous
            </Link>
            <Link
              href={pageHref(Math.min(totalPages, page + 1))}
              aria-disabled={page >= totalPages}
              className={cn(buttonVariants({ variant: "outline" }), page >= totalPages && "pointer-events-none opacity-50")}
            >
              Next
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
