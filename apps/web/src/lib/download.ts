/**
 * Hand an already-fetched blob to the browser as a file download. Kept out of
 * the api-client because it touches the DOM — the client stays environment-free.
 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
