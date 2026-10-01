import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

type Manifest = Record<string, { file: string; src?: string; css?: string[]; imports?: string[] }>;

export async function prerenderLanding(root: string, outDir: string) {
  const directory = path.resolve(root, outDir);
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
    collectCss('src/landing/LandingPage.tsx');
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
      ...[...css].map(file => `<link rel="stylesheet" href="/${file}" />`),
    ].join('\n');
    const shell = await readFile(path.join(directory, 'index.html'), 'utf8');
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
    const workerPath = path.join(directory, '_worker.js');
    const worker = await readFile(workerPath, 'utf8');
    if (!worker.includes('/* KOMA_SECURITY_HEADERS */ {}')) throw new Error('Missing worker security policy injection');
    await writeFile(workerPath, worker.replace('/* KOMA_SECURITY_HEADERS */ {}', JSON.stringify(securityHeaders)));
    console.log(`Public landing prerendered: ${markup.length} characters; ${css.size} stylesheets`);
  } finally {
    await server.close();
  }
}
