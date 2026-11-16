/* KÔMA public landing only. No PII, raw referrers, or arbitrary query parameters. */
(() => {
  if (window.location.hostname !== 'komafood.com.br') return;
  const id = document.currentScript?.dataset.measurementId || '';
  if (!/^G-[A-Z0-9]{6,20}$/.test(id) || window.__KOMA_GA4_STARTED__) return;
  window.__KOMA_GA4_STARTED__ = true;

  // Preserve campaign attribution while stripping personal information in URLs.
  const page = new URL(window.location.pathname, window.location.origin);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const value = new URLSearchParams(window.location.search).get(key);
    if (value && /^[a-z0-9_-]{1,64}$/i.test(value)) page.searchParams.set(key, value);
  }
  let safeReferrer = '';
  try {
    if (document.referrer) {
      const referrer = new URL(document.referrer);
      if (referrer.protocol === 'https:' || referrer.protocol === 'http:') {
        safeReferrer = referrer.origin + '/';
      }
    }
  } catch { /* Invalid referrers are never forwarded. */ }

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  gtag('js', new Date());
  gtag('config', id, {
    page_location: page.href,
    page_referrer: safeReferrer,
    page_title: document.title,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    send_page_view: true,
  });

  const loader = document.createElement('script');
  loader.async = true;
  loader.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(id);
  document.head.appendChild(loader);
})();
