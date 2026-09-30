// Cloudflare Pages Function to intercept any missing asset under /assets/*
// When a static asset exists in dist/assets/*, Cloudflare Pages serves the file directly
// from static asset storage and does NOT invoke this function.
// When an asset is NOT found (missing chunk, old deployment skew, or 404),
// Cloudflare Pages invokes this function instead of falling back to index.html (SPA).
// This guarantees:
// 1. Missing JS/CSS assets return a real HTTP 404 status.
// 2. Content-Type is text/plain, NEVER text/html (preventing MIME type rejection errors).
// 3. Cache-Control is no-store, preventing CDN and browser from caching the error.

export async function onRequest() {
  return new Response('Asset not found', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
