import { onRequest as serveAsset } from '../functions/assets/[[catchall]].ts';

const BRAND_HOSTS = new Set(['komafood.com.br', 'www.komafood.com.br']);
const PRIVATE_HOSTS = new Set(['app.komafood.com.br', 'central.komafood.com.br',
  'admin.komafood.com.br', 'superadmin.komafood.com.br', 'super-admin.komafood.com.br']);
const LANDING_PATHS = new Set(['/', '/index.html', '/landing', '/landing/']);

const PUBLIC_API_BASE_URL = typeof __KOMA_PUBLIC_API_BASE_URL__ === 'undefined'
  ? 'https://sistema-gourmet-bistro-production.up.railway.app'
  : __KOMA_PUBLIC_API_BASE_URL__;
const PUBLIC_STORAGE_ORIGIN = typeof __KOMA_PUBLIC_STORAGE_ORIGIN__ === 'undefined'
  ? 'https://iiowhekvahxiepwcdidm.supabase.co'
  : __KOMA_PUBLIC_STORAGE_ORIGIN__;
const SOCIAL_CRAWLER = /(?:whatsapp|facebookexternalhit|facebot|twitterbot|telegrambot|discordbot|slackbot|linkedinbot|pinterestbot)/i;
const PUBLIC_MENU_PATH = /^\/c\/([a-z0-9][a-z0-9_-]{0,126})\/?$/i;
const FALLBACK_MENU_IMAGE = 'https://app.komafood.com.br/logo-koma.png';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function resolveMenuImage(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048) return FALLBACK_MENU_IMAGE;
  const input = value.trim();
  let resolved;
  if (/^https:\/\//i.test(input)) {
    resolved = input;
  } else if (input.startsWith('/storage/v1/object/public/')) {
    resolved = PUBLIC_STORAGE_ORIGIN.replace(/\/$/, '') + input;
  } else if (input.startsWith('/') && !input.startsWith('//')) {
    resolved = 'https://app.komafood.com.br' + input;
  } else if (/^[a-z0-9_./-]+$/i.test(input) && !input.includes('..')) {
    resolved = PUBLIC_STORAGE_ORIGIN.replace(/\/$/, '')
      + '/storage/v1/object/public/cardapio-assets/' + input;
  } else {
    return FALLBACK_MENU_IMAGE;
  }
  try {
    const url = new URL(resolved);
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost'
      || /^(?:127\.|10\.|192\.168\.)/.test(url.hostname)) return FALLBACK_MENU_IMAGE;
    return url.href;
  } catch {
    return FALLBACK_MENU_IMAGE;
  }
}

async function fetchPublicMenuPreview(slug, apiBaseUrl, metadataFetch) {
  try {
    // Use the existing public, tenant-scoped projection. Never fetch with an
    // operator token, and never allow a user-supplied host to reach the edge.
    const endpoint = new URL('/api/cardapio-digital/config', apiBaseUrl);
    endpoint.searchParams.set('slug', slug);
    const response = await metadataFetch(endpoint.href, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const restaurant = await response.json();
    if (!restaurant || !Number.isSafeInteger(restaurant.id) || restaurant.id <= 0
      || typeof restaurant.nome !== 'string' || !restaurant.nome.trim()
      || (String(restaurant.id) !== slug
        && String(restaurant.slug || '').toLowerCase() !== slug.toLowerCase())) return null;

    const name = restaurant.nome.trim().slice(0, 120);
    const title = escapeHtml(name + ' | Cardápio');
    const description = escapeHtml('Confira o cardápio de ' + name + '.');
    const image = escapeHtml(resolveMenuImage(restaurant.logo_url));
    const canonical = 'https://app.komafood.com.br/c/' + encodeURIComponent(slug);
    const tags = [
      '<meta property="og:type" content="website" />',
      '<meta property="og:locale" content="pt_BR" />',
      '<meta property="og:title" content="' + title + '" />',
      '<meta property="og:description" content="' + description + '" />',
      '<meta property="og:url" content="' + canonical + '" />',
      '<meta property="og:image" content="' + image + '" />',
      '<meta property="og:image:alt" content="' + escapeHtml(name + ' — logo do restaurante') + '" />',
      '<meta name="twitter:card" content="summary" />',
      '<meta name="twitter:title" content="' + title + '" />',
      '<meta name="twitter:description" content="' + description + '" />',
      '<meta name="twitter:image" content="' + image + '" />',
    ].join('\n');
    return { title, tags };
  } catch {
    // API unavailable: keep the original SPA shell, without leaking errors or
    // injecting metadata from another restaurant.
    return null;
  }
}

// Keep the global operational CSP untouched; allow GA4 on the canonical
// public landing response only, without unsafe-inline or wildcard hosts.
export function withPublicLandingAnalyticsCsp(policy) {
  if (!policy) return policy;
  const permitted = {
    'script-src': ['https://www.googletagmanager.com'],
    'connect-src': ['https://www.google-analytics.com', 'https://region1.google-analytics.com', 'https://www.googletagmanager.com'],
    'img-src': ['https://www.google-analytics.com', 'https://www.googletagmanager.com'],
  };
  const directives = policy.split(';').map(value => value.trim()).filter(Boolean);
  for (const [name, sources] of Object.entries(permitted)) {
    const index = directives.findIndex(value => value.split(/\\s+/, 1)[0] === name);
    if (index === -1) {
      directives.push(name + " 'self' " + sources.join(' '));
    } else {
      const parts = directives[index].split(/\\s+/);
      directives[index] = [...parts, ...sources.filter(source => !parts.includes(source))].join(' ');
    }
  }
  return directives.join('; ');
}

// This worker only serves build-time public HTML. It never resolves sessions,
// queries the API, or changes the operational SPA's authentication/router.
export function createSeoWorker(securityHeaders = {}, apiBaseUrl = PUBLIC_API_BASE_URL, metadataFetch = fetch) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if ((request.method === 'GET' || request.method === 'HEAD') && /^\/cearatech(?:\/qr)?\/?$/.test(url.pathname)) {
        url.pathname = url.pathname.replace('/cearatech', '/siaratech');
        return new Response(null, { status: 308, headers: {
          ...securityHeaders, Location: url.href, 'Cache-Control': 'no-store',
        } });
      }
      if (url.pathname.startsWith('/assets/')) return serveAsset({ next: () => env.ASSETS.fetch(request) });
      const brandHost = BRAND_HOSTS.has(url.hostname);
      const privateHost = PRIVATE_HOSTS.has(url.hostname) || url.hostname.endsWith('.pages.dev');
      const view = url.searchParams.get('view')?.toLowerCase();
      const landing = brandHost && LANDING_PATHS.has(url.pathname) && (!view || view === 'landing');
      let response;
      if (url.pathname === '/seo-landing.html' || url.pathname === '/seo-landing') {
        response = new Response('Not found', { status: 404 });
      } else if (url.pathname === '/sitemap.xml' && !brandHost) {
        response = new Response('Not found', { status: 404 });
      } else if (url.pathname === '/robots.txt' && !brandHost) {
        // Allow the crawler to see the noindex response instead of hiding it
        // behind Disallow. Tenant public menus retain their existing indexing.
        response = new Response('User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      } else if (landing && (request.method === 'GET' || request.method === 'HEAD')) {
        const assetUrl = new URL('/seo-landing', url.origin);
        response = await env.ASSETS.fetch(new Request(assetUrl, request));
      } else {
        response = await env.ASSETS.fetch(request);
      }
      let menuMarkup = null;
      const menuPath = PUBLIC_MENU_PATH.exec(url.pathname);
      if (request.method === 'GET' && url.hostname === 'app.komafood.com.br'
        && menuPath && SOCIAL_CRAWLER.test(request.headers.get('User-Agent') || '')
        && response.ok && (response.headers.get('Content-Type') || '').toLowerCase().includes('text/html')) {
        const preview = await fetchPublicMenuPreview(menuPath[1], apiBaseUrl, metadataFetch);
        if (preview) {
          const shell = await response.text();
          if (shell.includes('</head>')) {
            menuMarkup = shell.replace('</head>', preview.tags + '\n</head>')
              .replace(/<title>[^<]*<\/title>/, '<title>' + preview.title + '</title>');
          } else {
            menuMarkup = shell;
          }
        }
      }
      const headers = new Headers(response.headers);
      if (menuMarkup !== null) {
        headers.delete('Content-Length');
        headers.delete('Content-Encoding');
        headers.delete('ETag');
      }
      for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, String(value));
      if (landing && url.hostname === 'komafood.com.br' && response.ok) {
        const policy = headers.get('Content-Security-Policy');
        if (policy) headers.set('Content-Security-Policy', withPublicLandingAnalyticsCsp(policy));
      }
      headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
      if (url.pathname === '/w/a' || url.pathname === '/whatsapp/avisos') {
        headers.set('Referrer-Policy', 'no-referrer');
        headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      // Public legal documents remain accessible, but their generic SPA shell
      // must not compete with the canonical marketing landing in brand search.
      const publicLegalPage = brandHost && /^\/legal(?:\/|$)/.test(url.pathname);
      if (privateHost || publicLegalPage || (brandHost && LANDING_PATHS.has(url.pathname) && !landing) || response.status === 404) {
        headers.set('X-Robots-Tag', 'noindex');
      } else if (landing) {
        headers.set('X-Robots-Tag', 'index, follow, max-image-preview:large');
        headers.set('Link', '<https://komafood.com.br/>; rel="canonical"');
      }
      return new Response(request.method === 'HEAD' ? null : (menuMarkup === null ? response.body : menuMarkup), {
        status: response.status, statusText: response.statusText, headers,
      });
    },
  };
}

// Build injects the existing policy and bundles the canonical asset handler.
export default createSeoWorker(typeof __KOMA_SECURITY_HEADERS__ === 'undefined' ? {} : __KOMA_SECURITY_HEADERS__);
