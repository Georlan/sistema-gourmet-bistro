/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type KomaSurface =
  | 'landing'
  | 'central'
  | 'public'
  | 'caixa'
  | 'garcom'
  | 'entregador'
  | 'acompanhar'
  | 'ativar';

export interface ResolvedKomaHost {
  kind: 'landing' | 'central' | 'tenant' | 'generic';
  surface: KomaSurface;
  tenantSlug: string | null;
  rawHostname: string;
}

export const RESERVED_SUBDOMAINS = new Set([
  'www',
  'central',
  'admin',
  'superadmin',
  'super-admin',
  'api',
  'app',
  'static',
  'assets',
  'mail',
  'smtp',
  'cardapio',
  'sistema-gourmet-bistro',
]);

const KNOWN_PLATFORM_ROOTS = [
  'komafood.com.br',
  'pages.dev',
  'railway.app',
  'up.railway.app',
  'vercel.app',
  'netlify.app',
  'github.io',
];

/**
 * Decompõe um subdomínio de primeiro nível nos componentes tenantSlug e superfície operacional.
 * Faz matching right-to-left para suportar slugs compostos com hífen (ex: "bar-do-sol-caixa").
 */
export function parseTenantSubdomain(subdomain: string): { slug: string; surface: KomaSurface } | null {
  const clean = subdomain.trim().toLowerCase();
  if (!clean || RESERVED_SUBDOMAINS.has(clean)) {
    return null;
  }

  // Superfícies operacionais reconhecidas como sufixo right-to-left
  const suffixes: Array<{ suffix: string; surface: KomaSurface }> = [
    { suffix: '-caixa', surface: 'caixa' },
    { suffix: '-gerencia', surface: 'caixa' },
    { suffix: '-garcom', surface: 'garcom' },
    { suffix: '-salao', surface: 'garcom' },
    { suffix: '-entregador', surface: 'entregador' },
    { suffix: '-motoboy', surface: 'entregador' },
  ];

  for (const { suffix, surface } of suffixes) {
    if (clean.endsWith(suffix)) {
      const slug = clean.slice(0, -suffix.length);
      if (slug.length >= 2) {
        return { slug, surface };
      }
    }
  }

  // Sem sufixo operacional: é o cardápio público do restaurante
  return { slug: clean, surface: 'public' };
}

/**
 * Resolve o papel da aplicação baseado no hostname, pathname e parâmetros da URL.
 * Segue a invariante de que komafood.com.br puro é Landing Page, central.komafood.com.br é SuperAdmin,
 * e subdomínios de primeiro nível roteiam diretamente para os tenants.
 */
export function resolveKomaHost(
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : '',
  search: string = typeof window !== 'undefined' ? window.location.search : '',
): ResolvedKomaHost {
  const cleanHost = hostname.trim().toLowerCase();
  const params = new URLSearchParams(search);
  const viewParam = params.get('view')?.toLowerCase() || '';

  // 1. Central / SuperAdmin exclusivo
  if (
    cleanHost === 'central.komafood.com.br' ||
    cleanHost.startsWith('central.') ||
    pathname.startsWith('/super-admin')
  ) {
    return {
      kind: 'central',
      surface: 'central',
      tenantSlug: null,
      rawHostname: cleanHost,
    };
  }

  // 2. Rotas explícitas de utilitários operacionais (ativar, acompanhar, entregador)
  if (pathname.startsWith('/ativar') || viewParam === 'ativar') {
    return {
      kind: 'generic',
      surface: 'ativar',
      tenantSlug: params.get('slug') || null,
      rawHostname: cleanHost,
    };
  }

  if (pathname.startsWith('/acompanhar') || viewParam === 'acompanhar') {
    return {
      kind: 'generic',
      surface: 'acompanhar',
      tenantSlug: params.get('slug') || null,
      rawHostname: cleanHost,
    };
  }

  if (pathname.startsWith('/entregador') || viewParam === 'entregador') {
    return {
      kind: 'generic',
      surface: 'entregador',
      tenantSlug: params.get('slug') || null,
      rawHostname: cleanHost,
    };
  }

  // 3. Landing page oficial
  const isApexLandingDomain = cleanHost === 'komafood.com.br' || cleanHost === 'www.komafood.com.br';
  const isExplicitLandingRoute = pathname.startsWith('/landing') || viewParam === 'landing';

  if (isExplicitLandingRoute || (isApexLandingDomain && pathname === '/')) {
    return {
      kind: 'landing',
      surface: 'landing',
      tenantSlug: null,
      rawHostname: cleanHost,
    };
  }

  // 4. Subdomínios do komafood.com.br (ex: pordosol.komafood.com.br, pordosol-caixa.komafood.com.br)
  if (cleanHost.endsWith('.komafood.com.br')) {
    const sub = cleanHost.replace(/\.komafood\.com\.br$/, '');
    const parsed = parseTenantSubdomain(sub);
    if (parsed) {
      return {
        kind: 'tenant',
        surface: parsed.surface,
        tenantSlug: parsed.slug,
        rawHostname: cleanHost,
      };
    }
  }

  // 5. Suporte a subdomínios locais para testes (ex: pordosol.localhost, pordosol-caixa.localhost)
  if (cleanHost.endsWith('.localhost')) {
    const sub = cleanHost.replace(/\.localhost$/, '');
    const parsed = parseTenantSubdomain(sub);
    if (parsed) {
      return {
        kind: 'tenant',
        surface: parsed.surface,
        tenantSlug: parsed.slug,
        rawHostname: cleanHost,
      };
    }
  }

  // 6. Ambientes de hospedagem compartilhada (pages.dev, railway, localhost padrão)
  const isPlatformHost = KNOWN_PLATFORM_ROOTS.some((root) => cleanHost.endsWith(root));
  const parts = cleanHost.split('.');

  // Subdomínio genérico que não seja plataforma
  if (
    parts.length > 2 &&
    !isPlatformHost &&
    !cleanHost.includes('localhost') &&
    !cleanHost.includes('127.0.0.1')
  ) {
    const parsed = parseTenantSubdomain(parts[0]);
    if (parsed) {
      return {
        kind: 'tenant',
        surface: parsed.surface,
        tenantSlug: parsed.slug,
        rawHostname: cleanHost,
      };
    }
  }

  // 7. Fallback por path/search (ex: /cardapio, /c/:slug, ?slug=...)
  const pathParts = pathname.split('/').filter(Boolean);
  let resolvedSlugFromPath: string | null = null;
  if (pathParts[0] === 'c' && pathParts[1]) {
    resolvedSlugFromPath = pathParts[1];
  } else if (params.get('slug')) {
    resolvedSlugFromPath = params.get('slug');
  }

  if (pathname.startsWith('/cardapio') || pathname.startsWith('/c/') || viewParam === 'cardapio') {
    return {
      kind: resolvedSlugFromPath ? 'tenant' : 'generic',
      surface: 'public',
      tenantSlug: resolvedSlugFromPath,
      rawHostname: cleanHost,
    };
  }

  if (viewParam === 'caixa' || viewParam === 'gerencia') {
    return {
      kind: resolvedSlugFromPath ? 'tenant' : 'generic',
      surface: 'caixa',
      tenantSlug: resolvedSlugFromPath,
      rawHostname: cleanHost,
    };
  }

  // Fallback padrão: ambiente operacional garçom
  return {
    kind: resolvedSlugFromPath ? 'tenant' : 'generic',
    surface: 'garcom',
    tenantSlug: resolvedSlugFromPath,
    rawHostname: cleanHost,
  };
}

/**
 * Helpers canônicos de construção de URLs para o tenant
 */
export function getTenantPublicMenuUrl(slug: string): string {
  const clean = slug.trim().toLowerCase();
  return `https://${clean}.komafood.com.br/`;
}

export function getTenantCaixaUrl(slug: string): string {
  const clean = slug.trim().toLowerCase();
  return `https://${clean}-caixa.komafood.com.br/`;
}

export function getTenantGarcomUrl(slug: string): string {
  const clean = slug.trim().toLowerCase();
  return `https://${clean}-garcom.komafood.com.br/`;
}

export function getTenantEntregadorUrl(slug: string): string {
  const clean = slug.trim().toLowerCase();
  return `https://${clean}-entregador.komafood.com.br/`;
}
