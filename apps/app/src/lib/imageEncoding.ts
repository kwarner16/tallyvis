/**
 * Converts a browser blob: URL (what `EstimatorContext`/`PhotoUpload`
 * already hold for every uploaded photo — see docs/decisions/0013-ai-
 * analysis-foundation.md) into a `data:` URI the caller can send to a
 * Server Action. A blob: URL is only ever valid within the tab that
 * created it — meaningless to a Node server process — so this is the one
 * place a photo's actual bytes cross that boundary, on demand, right
 * before an analysis request. Nothing about the existing temporary,
 * browser-only photo storage model changes; this doesn't persist anything.
 */
export async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

/** For flows (the dashboard's "New quote" AI panel) that read a freshly-picked `File` directly, with no intermediate blob: URL to preserve. */
export function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read photo."));
    reader.readAsDataURL(blob);
  });
}
