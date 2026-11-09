/** Browser/platform sniffing for install and authenticator flows (client only). */
export function platform() {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /android/i.test(ua);
  // In-app browsers (Instagram, Facebook, Gmail, WhatsApp…) can't add to the home screen.
  const inApp = /FBAN|FBAV|Instagram|Line\/|GSA\/|WhatsApp|Snapchat|LinkedInApp|Twitter/i.test(ua);
  const iosBrowser: 'safari' | 'chrome' | 'firefox' | 'edge' | 'other' = !ios
    ? 'other'
    : /CriOS/i.test(ua)
      ? 'chrome'
      : /FxiOS/i.test(ua)
        ? 'firefox'
        : /EdgiOS/i.test(ua)
          ? 'edge'
          : /Safari/i.test(ua) && !inApp
            ? 'safari'
            : 'other';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  return { ios, android, inApp, iosBrowser, standalone };
}

/**
 * Opens a custom-scheme URL (otpauth://, apple-otpauth://). Resolves true if the page was
 * hidden soon after (an app opened), false if nothing happened, so the caller can show a fallback.
 */
export function openAppLink(url: string, waitMs = 1600): Promise<boolean> {
  return new Promise((resolve) => {
    let left = false;
    const onHide = () => {
      if (document.visibilityState === 'hidden') left = true;
    };
    const onBlur = () => (left = true);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onBlur);
    window.addEventListener('blur', onBlur);
    window.location.href = url;
    setTimeout(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onBlur);
      window.removeEventListener('blur', onBlur);
      resolve(left);
    }, waitMs);
  });
}
