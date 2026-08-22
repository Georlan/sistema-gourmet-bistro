import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const buildSha = (
    process.env.CF_PAGES_COMMIT_SHA
    || process.env.GITHUB_SHA
    || process.env.GIT_COMMIT_SHA
    || ""
  ).slice(0, 12);
  return {
    define: {
      "import.meta.env.VITE_BUILD_SHA": JSON.stringify(buildSha || "não informado"),
    },
    plugins: [react(), tailwindcss()],
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
