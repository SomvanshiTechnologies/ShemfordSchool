// Clipboard helper with a legacy fallback for non-secure origins.
//
// navigator.clipboard is only exposed in secure contexts (HTTPS or
// localhost). On plain http://<ip> deployments the property is undefined
// and calling .writeText silently throws — copy buttons appear to do
// nothing. document.execCommand('copy') still works on HTTP, so we fall
// back to a hidden textarea + selection when the modern API isn't there.
export async function copyText(text) {
  const value = text == null ? '' : String(text);
  if (!value) return false;

  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall through to legacy path
    }
  }

  // The textarea must be FOCUSED and on-screen for the copy to actually land.
  // If it's off-screen or never focused, the browser copies whatever was
  // selected before (usually nothing) — execCommand still returns true, so the
  // UI says "copied" while the clipboard stays empty.
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.width = '1px';
    ta.style.height = '1px';
    ta.style.padding = '0';
    ta.style.border = 'none';
    ta.style.opacity = '0';
    ta.setAttribute('aria-hidden', 'true');
    document.body.appendChild(ta);
    const prevActive = document.activeElement;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta);
    if (prevActive && typeof prevActive.focus === 'function') {
      try { prevActive.focus(); } catch { /* ignore */ }
    }
    return ok;
  } catch {
    return false;
  }
}
