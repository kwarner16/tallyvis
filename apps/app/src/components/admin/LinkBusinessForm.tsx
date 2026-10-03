"use client";

import { useActionState, useState } from "react";
import { buttonVariants, cn } from "@tallyvis/ui";
import {
  linkCreatorBusinessAction,
  searchBusinessesForCreatorLinkAction,
  type BusinessSearchResult,
  type BusinessSearchState,
  type CreatorFormState,
} from "@/lib/creatorAdminActions";

const initialLinkState: CreatorFormState = {};
const initialSearchState: BusinessSearchState = {};

/**
 * Finds the creator's own TallyVis business by name/owner-email search
 * (reusing `/admin/businesses`'s own search) and lets the admin pick it
 * from the results, rather than requiring them to already know and
 * manually type its internal `business_...` id. The admin can only ever
 * select a real business returned by that search — the id submitted to
 * `linkCreatorBusinessAction` always comes from a search result the
 * backend itself produced, never from free text.
 */
export function LinkBusinessForm({ creatorId }: { creatorId: string }) {
  const [searchState, searchAction, searchPending] = useActionState(searchBusinessesForCreatorLinkAction, initialSearchState);
  const [linkState, linkAction, linkPending] = useActionState(linkCreatorBusinessAction, initialLinkState);
  const [selected, setSelected] = useState<BusinessSearchResult | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <form action={searchAction} className="flex flex-col gap-2">
        <label htmlFor="businessQuery" className="text-sm font-medium text-ink">
          Find their business
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="businessQuery"
            name="query"
            type="text"
            defaultValue={searchState.query}
            placeholder="Search by business name or owner email"
            className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
          />
          <button type="submit" disabled={searchPending} className={buttonVariants({ variant: "outline" })}>
            {searchPending ? "Searching…" : "Search"}
          </button>
        </div>
        {searchState.error ? <p className="text-sm text-red-700">{searchState.error}</p> : null}
      </form>

      {searchState.results ? (
        searchState.results.length === 0 ? (
          <p className="text-sm text-ink-soft">No businesses match &ldquo;{searchState.query}&rdquo;.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {searchState.results.map((business) => {
              const isSelected = selected?.id === business.id;
              return (
                <li key={business.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(business)}
                    className={cn(
                      "flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      isSelected ? "border-accent-strong bg-accent-strong/5" : "border-line bg-paper hover:bg-paper-alt",
                    )}
                  >
                    <span className="font-medium text-ink">{business.name}</span>
                    <span className="text-ink-faint">{business.ownerEmail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {selected ? (
        <div className="rounded-lg border border-line bg-paper-alt p-3">
          <p className="text-sm text-ink">
            Selected: <span className="font-semibold">{selected.name}</span>{" "}
            <span className="text-ink-soft">({selected.ownerEmail})</span>
          </p>
          <form action={linkAction} className="mt-2 flex flex-wrap items-center gap-2">
            <input type="hidden" name="creatorId" value={creatorId} />
            <input type="hidden" name="businessId" value={selected.id} />
            <button type="submit" disabled={linkPending} className={buttonVariants({ variant: "primary" })}>
              {linkPending ? "Linking…" : "Link this business"}
            </button>
            <button type="button" onClick={() => setSelected(null)} className={buttonVariants({ variant: "outline" })}>
              Change
            </button>
          </form>
          {linkState.error ? <p className="mt-2 text-sm text-red-700">{linkState.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
