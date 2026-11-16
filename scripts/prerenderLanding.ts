import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build, createServer } from 'vite';

type Manifest = Record<string, { file: string; src?: string; css?: string[]; imports?: string[] }>;

export async function prerenderLanding(root: string, outDir: string) {
  const directory = path.resolve(root, outDir);
  const functionFiles = (await readdir(path.join(root, 'functions'), { recursive: true }))
    .filter(file => /\.[jt]s$/.test(file));
  if (functionFiles.some(file => file !== 'assets/[[catchall]].ts')) {
    throw new Error('New Pages Functions must be integrated into the SEO worker before deployment');
  }
  // The GA4 measurement ID is public (not a secret). Cloudflare may override it
  // with VITE_GA4_MEASUREMENT_ID; the tracked default makes the first deploy work.
  const publicAnalytics = JSON.parse(await readFile(
    path.join(root, 'src/landing/config/publicMarketingAnalytics.json'), 'utf8',
  )) as { ga4MeasurementId: string };
  const ga4MeasurementId = (process.env.VITE_GA4_MEASUREMENT_ID || publicAnalytics.ga4MeasurementId).trim();
  if (!/^G-[A-Z0-9]{6,20}$/.test(ga4MeasurementId)) {
    throw new Error('Invalid public GA4 measurement ID');
  }
  const manifest: Manifest = JSON.parse(await readFile(path.join(directory, '.vite/manifest.json'), 'utf8'));
  const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  try {
    const { render } = await server.ssrLoadModule('/src/landing/prerender.tsx');
    const { html: rawMarkup, seo, structuredData } = render();
    const markup = rawMarkup.replace(/(["'])\/src\/assets\/([^"']+)\1/g, (_match: string, quote: string, asset: string) => {
      const entry = manifest[`src/assets/${asset}`];
      if (!entry) throw new Error(`Missing prerender asset: ${asset}`);
      return `${quote}/${entry.file}${quote}`;
    });
    const css = new Set<string>();
    const visited = new Set<string>();
    const collectCss = (key: string) => {
      if (visited.has(key)) return;
      visited.add(key);
      const entry = manifest[key];
      if (!entry) return;
      entry.css?.forEach(file => css.add(file));
      entry.imports?.forEach(collectCss);
    };
    const publicEntry = manifest['src/landing/publicMain.tsx'];
    const operationalEntry = manifest['index.html'];
    if (!publicEntry || !operationalEntry) throw new Error('Missing separate public and operational Vite entries');
    collectCss('src/landing/publicMain.tsx');
    const operationalCss = new Set(operationalEntry.css ?? []);
    for (const file of operationalCss) css.delete(file);
    const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const head = [
      `<meta name="description" content="${escape(seo.description)}" />`,
      '<meta name="robots" content="index, follow, max-image-preview:large" />',
      `<link rel="canonical" href="${seo.url}" />`,
      `<meta property="og:title" content="${escape(seo.title)}" />`,
      `<meta property="og:description" content="${escape(seo.description)}" />`,
      '<meta property="og:type" content="website" />',
      '<meta property="og:site_name" content="KÔMA" />',
      '<meta property="og:locale" content="pt_BR" />',
      `<meta property="og:url" content="${seo.url}" />`,
      `<meta property="og:image" content="${seo.image}" />`,
      '<meta property="og:image:alt" content="KÔMA — Sistema para restaurantes" />',
      '<meta name="twitter:card" content="summary" />',
      `<meta name="twitter:title" content="${escape(seo.title)}" />`,
      `<meta name="twitter:description" content="${escape(seo.description)}" />`,
      `<meta name="twitter:image" content="${seo.image}" />`,
      `<script type="application/ld+json" id="koma-software-schema">${structuredData}</script>`,
      // Included only in the public prerender (never the shared operational index.html).
      `<script defer src="/ga4-landing.js" data-measurement-id="${ga4MeasurementId}"></script>`,
      ...[...css].map(file => `<link rel="stylesheet" href="/${file}" />`),
    ].join('\n');
    let shell = await readFile(path.join(directory, 'index.html'), 'utf8');
    // Never hydrate the public pre-render with the operational main entry.
    // It would re-introduce the entire operational CSS and thousands of unused modules.
    const operationalScript = `<script type="module" crossorigin src="/${operationalEntry.file}"></script>`;
    const publicScript = `<script type="module" crossorigin src="/${publicEntry.file}"></script>`;
    if (!shell.includes(operationalScript)) throw new Error('Missing operational entry script in shell');
    shell = shell.replace(operationalScript, publicScript);
    for (const file of operationalCss) {
      shell = shell.replace(`<link rel="stylesheet" crossorigin href="/${file}">`, '');
    }
    const document = shell.replace(/<title>[^<]*<\/title>/, `<title>${escape(seo.title)}</title>`)
      .replace('</head>', `${head}\n</head>`)
      .replace('<div id="root"></div>', `<div id="root">${markup}</div>`);
    if (document === shell || /["']\/src\/assets\//.test(document)) throw new Error('Incomplete public prerender');
    // Fail the build if HTML references a missing production asset or loses
    // the actual page content/metadata. Unit tests run before build in CI.
    if (!document.includes('<h1') || !document.includes('id="koma-software-schema"') || css.size === 0) {
      throw new Error('Public prerender is missing content, schema or styles');
    }
    const assets = new Set([...document.matchAll(/(?:src|href)="(\/assets\/[^"#?]+)"/g)].map(match => match[1]));
    await Promise.all([...assets].map(asset => access(path.join(directory, asset.slice(1)))));
    await writeFile(path.join(directory, 'seo-landing.html'), document);

    // Functions do not automatically inherit static _headers. Reuse its
    // canonical policy rather than maintaining a weaker/duplicate CSP.
    const headerFile = await readFile(path.join(directory, '_headers'), 'utf8');
    const globalBlock = headerFile.match(/(?:^|\n)\/\*\n((?:[ \t]+[^\n]+\n?)+)/)?.[1];
    if (!globalBlock) throw new Error('Missing global security policy');
    const securityHeaders = Object.fromEntries(globalBlock.trim().split('\n').map(line => {
      const separator = line.indexOf(':');
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    }));
    // Advanced mode replaces Pages Functions; bundle their canonical asset
    // handler into this worker so missing hashes still return real 404s.
    await build({
      configFile: false, root, publicDir: false,
      define: {
        __KOMA_SECURITY_HEADERS__: JSON.stringify(securityHeaders),
        // The edge preview reads the same public API and image storage as the SPA.
        __KOMA_PUBLIC_API_BASE_URL__: JSON.stringify(
          (process.env.VITE_API_URL || 'https://sistema-gourmet-bistro-production.up.railway.app').replace(/\/+$/, ''),
        ),
        __KOMA_PUBLIC_STORAGE_ORIGIN__: JSON.stringify(
          (process.env.VITE_SUPABASE_URL || 'https://iiowhekvahxiepwcdidm.supabase.co').replace(/\/+$/, ''),
        ),
      },
      build: {
        outDir: directory, emptyOutDir: false, minify: false,
        lib: { entry: path.join(root, 'public/_worker.js'), formats: ['es'], fileName: () => '_worker.js' },
      },
    });
    console.log(`Public landing prerendered: ${markup.length} characters; ${css.size} stylesheets`);
  } finally {
    await server.close();
  }
}
