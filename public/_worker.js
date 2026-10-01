const BRAND_HOSTS = new Set(['komafood.com.br', 'www.komafood.com.br']);
const PRIVATE_HOSTS = new Set(['app.komafood.com.br', 'central.komafood.com.br',
  'admin.komafood.com.br', 'superadmin.komafood.com.br', 'super-admin.komafood.com.br']);
const LANDING_PATHS = new Set(['/', '/index.html', '/landing', '/landing/']);

// This worker only serves build-time public HTML. It never resolves sessions,
// queries the API, or changes the operational SPA's authentication/router.
export function createSeoWorker(securityHeaders = {}) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const brandHost = BRAND_HOSTS.has(url.hostname);
      const privateHost = PRIVATE_HOSTS.has(url.hostname) || url.hostname.endsWith('.pages.dev');
      const view = url.searchParams.get('view')?.toLowerCase();
      const landing = brandHost && LANDING_PATHS.has(url.pathname) && (!view || view === 'landing');
      let response;
      if (url.pathname === '/seo-landing.html') {
        response = new Response('Not found', { status: 404 });
      } else if (url.pathname === '/sitemap.xml' && !brandHost) {
        response = new Response('Not found', { status: 404 });
      } else if (url.pathname === '/robots.txt' && !brandHost) {
        // Allow the crawler to see the noindex response instead of hiding it
        // behind Disallow. Tenant public menus retain their existing indexing.
        response = new Response('User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } else if (landing && (request.method === 'GET' || request.method === 'HEAD')) {
        const assetUrl = new URL('/seo-landing.html', url.origin);
        response = await env.ASSETS.fetch(new Request(assetUrl, request));
      } else {
        response = await env.ASSETS.fetch(request);
      }
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, String(value));
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      if (privateHost || (brandHost && LANDING_PATHS.has(url.pathname) && !landing) || response.status === 404) {
        headers.set('X-Robots-Tag', 'noindex');
      } else if (landing) {
        headers.set('X-Robots-Tag', 'index, follow, max-image-preview:large');
        headers.set('Link', '<https://komafood.com.br/>; rel="canonical"');
      }
      return new Response(request.method === 'HEAD' ? null : response.body, {
        status: response.status, statusText: response.statusText, headers,
      });
    },
  };
}

// Build injects the existing global _headers policy here so Function responses
// preserve exactly the same security policy as static Pages responses.
export default createSeoWorker(/* KOMA_SECURITY_HEADERS */ {});
