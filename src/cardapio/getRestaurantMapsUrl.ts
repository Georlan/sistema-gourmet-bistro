/**
 * Resolve a restaurant's Maps field into a safe, absolute Google Maps URL.
 *
 * Operators may paste a full Maps link or only an address/Plus Code. Never
 * render a raw, relative value as href: on /c/:slug it becomes a broken menu
 * route instead of navigation. Preserve '+' in Plus Codes with URL encoding.
 */
export function getRestaurantMapsUrl(input: string | null | undefined): string | null {
  const location = input?.trim();
  if (!location) return null;

  // Accept official Google Maps URLs copied without a protocol.
  const withProtocol = /^(?:www\.google\.com\/maps(?:\/|\?|$)|maps\.google\.com(?:\/|\?|$)|maps\.app\.goo\.gl\/|goo\.gl\/maps\/)/i.test(location)
    ? `https://${location}`
    : location;

  if (/^https?:\/\//i.test(withProtocol)) {
    try {
      const url = new URL(withProtocol);
      if (url.protocol !== "https:") return null;
      const host = url.hostname.toLowerCase();
      const officialMaps =
        host === "maps.google.com" ||
        host === "maps.app.goo.gl" ||
        (host === "goo.gl" && url.pathname.startsWith("/maps/")) ||
        ((host === "google.com" || host === "www.google.com") &&
          (url.pathname === "/maps" || url.pathname.startsWith("/maps/")));
      return officialMaps ? url.toString() : null;
    } catch {
      return null;
    }
  }

  // No other schemes, protocol-relative links or third-party hosts are allowed.
  if (/^[a-z][a-z0-9+.-]*:/i.test(withProtocol) || withProtocol.startsWith("//")) return null;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(location)}`;
}
