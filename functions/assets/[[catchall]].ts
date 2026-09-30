// Cloudflare Pages Function for /assets/*.
//
// Pages Functions run BEFORE static assets when their route matches. Therefore
// this handler must explicitly delegate to the asset server and only replace
// the SPA HTML fallback used for missing hashed assets.
type AssetRouteContext = {
  next: () => Promise<Response>;
};

export async function onRequest(context: AssetRouteContext) {
  const response = await context.next();
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  // A real Vite asset under /assets/* must never be HTML. If Pages falls back
  // to index.html for a missing/old hash, turn that masked 200 into a real 404
  // and make the response uncacheable.
  if (response.status === 404 || contentType.includes('text/html')) {
    return new Response('Asset not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  return response;
}
