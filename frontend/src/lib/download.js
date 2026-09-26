// Saving a blob response under the filename the server chose.
//
// Opening a blob URL in a tab (window.open) discards Content-Disposition, so
// the browser falls back to a blob-uuid filename. Reading the header ourselves
// and driving an <a download> is what makes "FeesReceipt_StudentName.pdf" stick.
//
// The header is only readable cross-origin when the API exposes it — see
// expose_headers in backend/server.py.

/** Pull the filename out of a Content-Disposition header, if it has one. */
export function filenameFromResponse(res, fallback) {
  const cd = res?.headers?.['content-disposition'] || '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  if (!match?.[1]) return fallback;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1] || fallback;   // not percent-encoded — use it as sent
  }
}

/**
 * Save an axios blob response to disk, preferring the server's filename.
 * `fallback` is used when the response carries no Content-Disposition.
 */
export function downloadBlobResponse(res, fallback = 'download.pdf', type = 'application/pdf') {
  const blob = res.data instanceof Blob ? res.data : new Blob([res.data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filenameFromResponse(res, fallback);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
