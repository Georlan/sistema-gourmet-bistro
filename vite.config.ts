import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { scaleOperationalText } from './scripts/scaleOperationalText';
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
    css: { postcss: { plugins: [scaleOperationalText()] } },
    build: {
      manifest: true,
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, 'index.html'),
          publicMarketing: path.resolve(__dirname, 'src/landing/publicMain.tsx'),
        },
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('lucide-react')) return 'vendor-icons';
            if (
              id.includes('/node_modules/react/')
              || id.includes('/node_modules/react-dom/')
              || id.includes('/node_modules/scheduler/')
            ) {
              return 'vendor-react';
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api': {
          target: 'https://sistema-gourmet-bistro-production.up.railway.app',
          changeOrigin: true,
          secure: false,
        },
      },
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
