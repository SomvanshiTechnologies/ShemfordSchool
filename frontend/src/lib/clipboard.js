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

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '-9999px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    const prevActive = document.activeElement;
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
    return ok;
  } catch {
    return false;
  }
}
