/**
 * Universal Clipboard Copy Utility with Mobile and Insecure Context (HTTP LAN) Fallback.
 *
 * Modern browsers restrict `navigator.clipboard.writeText` strictly to Secure Contexts (HTTPS/localhost).
 * When running over LAN (e.g. on a mobile phone at http://192.168.x.x:5173), `navigator.clipboard` is
 * undefined. This utility transparently handles both modern async clipboard API and a rock-solid
 * document.execCommand fallback with iOS/Android viewport protection.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Try modern Async Clipboard API if available and in secure context
  if (typeof window !== 'undefined' && window.isSecureContext && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText threw an error, falling back to textarea selection:', err);
    }
  }

  // 2. Fallback for mobile browsers and insecure contexts (HTTP LAN IP)
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;

    // Prevent scrolling to bottom of page on iOS / Android
    textArea.style.position = 'fixed';
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.width = '2em';
    textArea.style.height = '2em';
    textArea.style.padding = '0';
    textArea.style.border = 'none';
    textArea.style.outline = 'none';
    textArea.style.boxShadow = 'none';
    textArea.style.background = 'transparent';
    textArea.style.fontSize = '16px'; // Prevents auto-zoom in mobile Safari
    textArea.setAttribute('readonly', '');

    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999); // Mobile Safari support

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('All clipboard copy methods failed:', err);
    return false;
  }
}
