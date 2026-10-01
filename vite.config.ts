import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { prerenderLanding } from './scripts/prerenderLanding';

export default defineConfig(() => {
  const buildSha = (
    process.env.CF_PAGES_COMMIT_SHA
    || process.env.GITHUB_SHA
    || process.env.GIT_COMMIT_SHA
    || ""
  ).slice(0, 12);
  const buildTime = new Date().toISOString();
  return {
    // Worktrees may share node_modules, but must not share the E2E optimizer cache.
    cacheDir: process.env.KOMA_E2E === 'true' ? path.resolve(__dirname, '.vite/e2e') : undefined,
    define: {
      "import.meta.env.VITE_BUILD_SHA": JSON.stringify(buildSha || "não informado"),
      "import.meta.env.VITE_BUILD_TIME": JSON.stringify(buildTime),
    },
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'koma-public-prerender',
        apply: 'build',
        async closeBundle() { await prerenderLanding(process.cwd(), 'dist'); },
      },
      {
        name: 'koma-build-metadata',
        transformIndexHtml(html: string) {
          const metaTags = [
            `<meta name="koma-build-sha" content="${buildSha || 'development'}" />`,
            `<meta name="koma-build-time" content="${buildTime}" />`,
          ].join('\n    ');
          return html.replace('</head>', `    ${metaTags}\n  </head>`);
        },
        generateBundle() {
          const payload = JSON.stringify(
            {
              sha: buildSha || 'development',
              builtAt: buildTime,
            },
            null,
            2,
          );
          this.emitFile({ type: 'asset', fileName: 'meta.json', source: payload });
          this.emitFile({ type: 'asset', fileName: 'build-info.json', source: payload });
        },
      },
    ],
    build: { manifest: true },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {
        ignored: [
          '**/bistro.db',
          '**/bistro.db-wal',
          '**/bistro.db-shm',
          '**/backend/bistro.db',
          '**/backend/bistro.db-wal',
          '**/backend/bistro.db-shm',
          '**/*.db',
          '**/*.db-wal',
          '**/*.db-shm'
        ]
      },
    },
  };
});
