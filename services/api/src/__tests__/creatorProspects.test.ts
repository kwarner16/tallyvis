import { describe, expect, it } from "vitest";
import { useTestDb } from "./testHarness";
import { signUp } from "../services/auth";
import { setUserIsAdmin } from "../repositories/users";
import {
  previewCreatorProspectImportAdmin,
  commitCreatorProspectImportAdmin,
  updateCreatorProspectAdmin,
  listCreatorOutreachQueueAdmin,
  getCreatorProspectDetailAdmin,
  convertProspectToCreatorAdmin,
  normalizeEmail,
  isSafeHttpUrl,
  normalizeProfileUrl,
} from "../services/creatorProspects";
import { findCreatorProspectsByNormalizedEmails, findCreatorProspectsByNormalizedProfileUrls } from "../repositories/creatorProspects";
import { getCreatorById } from "../repositories/creators";

const getDb = useTestDb();

/** Shared schema per test FILE, not per test case — every email/name/URL below must be unique across the whole file. */
let counter = 0;
function uniqueN(): number {
  counter += 1;
  return counter;
}
function uniqueEmail(): string {
  return `creator${uniqueN()}@example.com`;
}
function uniqueUrl(): string {
  return `https://youtube.com/@creator${uniqueN()}`;
}

async function newAdmin() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Admin Co",
    ownerEmail: `admin-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  await setUserIsAdmin(db, session.userId, true);
  return { db, session };
}

async function newNonAdmin() {
  const db = getDb();
  const { session } = await signUp(db, {
    businessName: "Regular Co",
    ownerEmail: `regular-${Math.random()}@example.com`,
    password: "correct-horse-battery",
  });
  return { db, session };
}

describe("isSafeHttpUrl / normalizeProfileUrl / normalizeEmail", () => {
  it("accepts http/https URLs only", () => {
    expect(isSafeHttpUrl("https://youtube.com/@steveo")).toBe(true);
    expect(isSafeHttpUrl("http://example.com")).toBe(true);
  });

  it("rejects unsafe schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(isSafeHttpUrl("not a url")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });

  it("canonicalizes host+path, stripping www. and a trailing slash", () => {
    expect(normalizeProfileUrl("https://www.youtube.com/@SteveO/")).toBe("youtube.com/@steveo");
    expect(normalizeProfileUrl("https://youtube.com/@SteveO")).toBe("youtube.com/@steveo");
  });

  it("strips a small set of known platform 'tab' suffixes so the same channel collapses to one canonical form", () => {
    expect(normalizeProfileUrl("https://youtube.com/@steveo/videos")).toBe("youtube.com/@steveo");
    expect(normalizeProfileUrl("https://youtube.com/@steveo/featured")).toBe("youtube.com/@steveo");
    expect(normalizeProfileUrl("https://youtube.com/@steveo/about")).toBe("youtube.com/@steveo");
  });

  it("returns undefined for an unsafe scheme rather than a canonicalized string", () => {
    expect(normalizeProfileUrl("javascript:alert(1)")).toBeUndefined();
  });

  it("normalizes email to lowercase/trimmed, and rejects an invalid format", () => {
    expect(normalizeEmail("  Steve@Example.com  ")).toBe("steve@example.com");
    expect(normalizeEmail("not-an-email")).toBeUndefined();
  });
});

describe("previewCreatorProspectImportAdmin / commitCreatorProspectImportAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    const list = `Creator Name | Email\nSteveO | ${uniqueEmail()}`;
    await expect(previewCreatorProspectImportAdmin(db, session, list)).rejects.toThrow(/admin access required/i);
    await expect(commitCreatorProspectImportAdmin(db, session, list)).rejects.toThrow(/admin access required/i);
  });

  it("classifies every row as new on a first-time import, with missing optional fields left undefined", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    const url = uniqueUrl();
    const list = `Creator Name | Contact Name | Email | Primary Platform | Profile URL | Niche | Followers | Source
SteveO The Window Cleaner | Steve | ${email} | YouTube | ${url} | Window Cleaning | 42K | ChatGPT
No Extra Info Creator | | | | ${uniqueUrl()} | | | `;

    const preview = await previewCreatorProspectImportAdmin(db, session, list);
    expect(preview.counts).toEqual({ new: 2, duplicate: 0, possible_duplicate: 0, invalid: 0 });
    expect(preview.rows[1]).toMatchObject({ contactName: undefined, email: undefined, niche: undefined });
  });

  it("commits only new rows, storing normalized email/profile URL and parsing followers ('42K' -> 42000)", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    const url = uniqueUrl();
    const list = `Creator Name | Email | Profile URL | Followers\nSteveO | ${email} | ${url} | 42K`;

    const result = await commitCreatorProspectImportAdmin(db, session, list);
    expect(result.createdCount).toBe(1);

    const [stored] = await findCreatorProspectsByNormalizedEmails(db, [email.toLowerCase()]);
    expect(stored?.displayName).toBe("SteveO");
    expect(stored?.followersApprox).toBe(42_000);
    expect(stored?.normalizedProfileUrl).toBe(url.replace("https://", ""));
  });

  it("a creator with a profile URL but NO email is still importable", async () => {
    const { db, session } = await newAdmin();
    const url = uniqueUrl();
    const result = await commitCreatorProspectImportAdmin(db, session, `Creator Name | Profile URL\nURL Only Creator | ${url}`);
    expect(result.createdCount).toBe(1);

    const [stored] = await findCreatorProspectsByNormalizedProfileUrls(db, [url.replace("https://", "")]);
    expect(stored?.displayName).toBe("URL Only Creator");
    expect(stored?.contactEmail).toBeUndefined();
  });

  it("re-importing the EXACT same list a second time creates zero new prospects", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    const list = `Creator Name | Email\nRepeat Creator | ${email}`;

    await commitCreatorProspectImportAdmin(db, session, list);
    const second = await commitCreatorProspectImportAdmin(db, session, list);
    expect(second.createdCount).toBe(0);
    expect(second.counts.duplicate).toBe(1);
  });

  it("detects a duplicate by normalized EMAIL even with different casing/whitespace", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nDup Email Creator | ${email}`);

    const preview = await previewCreatorProspectImportAdmin(
      db,
      session,
      `Creator Name | Email\nDup Email Creator | ${email.toUpperCase()}`,
    );
    expect(preview.counts.duplicate).toBe(1);
  });

  it("detects a duplicate by normalized/canonical PROFILE URL even with a different format (www., trailing slash, /videos)", async () => {
    const { db, session } = await newAdmin();
    const n = uniqueN();
    await commitCreatorProspectImportAdmin(
      db,
      session,
      `Creator Name | Profile URL\nCanonical URL Creator | https://youtube.com/@creator${n}`,
    );

    const preview = await previewCreatorProspectImportAdmin(
      db,
      session,
      `Creator Name | Profile URL\nCanonical URL Creator | https://www.youtube.com/@creator${n}/videos`,
    );
    expect(preview.counts.duplicate).toBe(1);
  });

  it("flags a matching display name with DIFFERENT email/URL as a possible duplicate, not blocked outright", async () => {
    const { db, session } = await newAdmin();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nPossible Dup Creator | ${uniqueEmail()}`);

    const preview = await previewCreatorProspectImportAdmin(
      db,
      session,
      `Creator Name | Email\nPossible Dup Creator | ${uniqueEmail()}`,
    );
    expect(preview.counts.possible_duplicate).toBe(1);
    expect(preview.counts.new).toBe(0);
  });

  it("does not treat display name alone as a duplicate key for a genuinely different creator", async () => {
    const { db, session } = await newAdmin();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nUnique Name Creator A | ${uniqueEmail()}`);
    const preview = await previewCreatorProspectImportAdmin(db, session, `Creator Name | Email\nUnique Name Creator B | ${uniqueEmail()}`);
    expect(preview.counts.new).toBe(1);
  });

  it("marks a row with no name, no email, and no URL as invalid and never imports it", async () => {
    const { db, session } = await newAdmin();
    // Comma-delimited deliberately — an all-pipe/whitespace data row is
    // indistinguishable from a Markdown separator row and is treated as
    // blank/skippable instead (see salesImportParsing.test.ts's identical
    // note).
    const result = await commitCreatorProspectImportAdmin(db, session, "Creator Name,Email\n,");
    expect(result.createdCount).toBe(0);
    expect(result.counts.invalid).toBe(1);
  });

  it("marks a row with a name but NEITHER a usable email NOR a usable profile URL as invalid", async () => {
    const { db, session } = await newAdmin();
    const result = await commitCreatorProspectImportAdmin(
      db,
      session,
      "Creator Name | Email | Profile URL\nNo Contact Creator | not-an-email | not-a-url",
    );
    expect(result.createdCount).toBe(0);
    expect(result.counts.invalid).toBe(1);
  });

  it("an unsafe profile-url SCHEME never reaches storage, even when the row also has a valid email (still importable via email alone)", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    const result = await commitCreatorProspectImportAdmin(
      db,
      session,
      `Creator Name | Email | Profile URL\nUnsafe URL Creator | ${email} | javascript:alert(1)`,
    );
    expect(result.createdCount).toBe(1);

    const [stored] = await findCreatorProspectsByNormalizedEmails(db, [email.toLowerCase()]);
    expect(stored?.profileUrl).toBeUndefined();
    expect(stored?.normalizedProfileUrl).toBeUndefined();
  });
});

describe("updateCreatorProspectAdmin", () => {
  it("corrects contact info, re-normalizing a changed email", async () => {
    const { db, session } = await newAdmin();
    const original = uniqueEmail();
    const replacement = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nEdit Test Creator | ${original}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [original]);

    const updated = await updateCreatorProspectAdmin(db, session, prospect!.id, { contactEmail: replacement });
    expect(updated.contactEmail).toBe(replacement);
    expect(updated.normalizedEmail).toBe(replacement);
  });

  it("rejects an invalid email format", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nBad Email Edit Creator | ${email}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [email]);
    await expect(updateCreatorProspectAdmin(db, session, prospect!.id, { contactEmail: "not-an-email" })).rejects.toThrow(/valid email/i);
  });

  it("rejects an unsafe profile URL scheme", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nBad URL Edit Creator | ${email}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [email]);
    await expect(updateCreatorProspectAdmin(db, session, prospect!.id, { profileUrl: "javascript:alert(1)" })).rejects.toThrow(
      /valid http/i,
    );
  });

  it("rejects clearing the creator name entirely", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nClear Name Edit Creator | ${email}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [email]);
    await expect(updateCreatorProspectAdmin(db, session, prospect!.id, { displayName: "" })).rejects.toThrow(/creator name/i);
  });

  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(updateCreatorProspectAdmin(db, session, "creatorprospect_whatever", { displayName: "X" })).rejects.toThrow(
      /admin access required/i,
    );
  });
});

describe("listCreatorOutreachQueueAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(listCreatorOutreachQueueAdmin(db, session)).rejects.toThrow(/admin access required/i);
  });

  it("excludes a CONVERTED prospect from the queue entirely", async () => {
    const { db, session } = await newAdmin();
    const email = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nQueue Convert Creator | ${email}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [email]);

    await convertProspectToCreatorAdmin(db, session, prospect!.id, {
      slug: `queueconvert${uniqueN()}`,
      email: uniqueEmail(),
    });

    const queue = await listCreatorOutreachQueueAdmin(db, session);
    expect(queue.find((e) => e.prospect.id === prospect!.id)).toBeUndefined();
  });
});

describe("getCreatorProspectDetailAdmin", () => {
  it("returns undefined for an unknown prospect id", async () => {
    const { db, session } = await newAdmin();
    expect(await getCreatorProspectDetailAdmin(db, session, "creatorprospect_does-not-exist")).toBeUndefined();
  });
});

describe("convertProspectToCreatorAdmin", () => {
  it("rejects a non-admin caller", async () => {
    const { db, session } = await newNonAdmin();
    await expect(
      convertProspectToCreatorAdmin(db, session, "creatorprospect_whatever", { slug: "x", email: uniqueEmail() }),
    ).rejects.toThrow(/admin access required/i);
  });

  it("creates a real creator via the existing createCreatorAdmin logic, in its normal default (non-active) status, and links the prospect", async () => {
    const { db, session } = await newAdmin();
    const prospectEmail = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email | Primary Platform\nConvert Test Creator | ${prospectEmail} | YouTube`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [prospectEmail]);

    const creatorEmail = uniqueEmail();
    const slug = `converttest${uniqueN()}`;
    const creator = await convertProspectToCreatorAdmin(db, session, prospect!.id, { slug, email: creatorEmail });

    expect(creator.slug).toBe(slug);
    expect(creator.email).toBe(creatorEmail);
    expect(creator.name).toBe("Convert Test Creator");
    expect(creator.status).toBe("prospect"); // never auto-activated
    expect(creator.complimentaryAccess).toBe(false); // never auto-granted

    const updatedProspect = await getCreatorProspectDetailAdmin(db, session, prospect!.id);
    expect(updatedProspect?.prospect.convertedCreatorId).toBe(creator.id);
    expect(updatedProspect?.prospect.status).toBe("converted");

    const realCreator = await getCreatorById(db, creator.id);
    expect(realCreator).toBeDefined();
  });

  it("rejects converting a prospect that was already converted", async () => {
    const { db, session } = await newAdmin();
    const prospectEmail = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nDouble Convert Creator | ${prospectEmail}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [prospectEmail]);

    await convertProspectToCreatorAdmin(db, session, prospect!.id, { slug: `doubleconvert${uniqueN()}`, email: uniqueEmail() });

    await expect(
      convertProspectToCreatorAdmin(db, session, prospect!.id, { slug: `doubleconvert2${uniqueN()}`, email: uniqueEmail() }),
    ).rejects.toThrow(/already been converted/i);
  });

  it("never leaves an orphaned creator behind when conversion fails (e.g. a slug collision) — the whole transaction rolls back", async () => {
    const { db, session } = await newAdmin();
    const takenSlug = `takenslug${uniqueN()}`;
    // Create a creator that already owns `takenSlug` directly, independent of outreach.
    const { createCreatorAdmin } = await import("../services/creators");
    await createCreatorAdmin(db, session, { slug: takenSlug, name: "Existing Creator", email: uniqueEmail() });

    const prospectEmail = uniqueEmail();
    await commitCreatorProspectImportAdmin(db, session, `Creator Name | Email\nSlug Collision Creator | ${prospectEmail}`);
    const [prospect] = await findCreatorProspectsByNormalizedEmails(db, [prospectEmail]);

    await expect(
      convertProspectToCreatorAdmin(db, session, prospect!.id, { slug: takenSlug, email: uniqueEmail() }),
    ).rejects.toThrow(/already taken/i);

    const reloaded = await getCreatorProspectDetailAdmin(db, session, prospect!.id);
    expect(reloaded?.prospect.convertedCreatorId).toBeUndefined();
    expect(reloaded?.prospect.status).not.toBe("converted");
  });
});
