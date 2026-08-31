import { defineConfig } from '@playwright/test';

const port = Number(process.env.KOMA_E2E_PORT || 4173);
const baseURL = `http://127.0.0.1:${port}`;

const viewportMatrix = [
  { name: 'mobile-360', width: 360, height: 640, touch: true },
  { name: 'mobile-390', width: 390, height: 720, touch: true },
  { name: 'mobile-412', width: 412, height: 732, touch: true },
  { name: 'tablet-768', width: 768, height: 900, touch: true },
  { name: 'desktop-1024', width: 1024, height: 768, touch: false },
  { name: 'desktop-1366', width: 1366, height: 768, touch: false },
  { name: 'desktop-1440', width: 1440, height: 900, touch: false },
  { name: 'desktop-1920', width: 1920, height: 1080, touch: false },
] as const;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    browserName: 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: viewportMatrix.map(({ name, width, height, touch }) => ({
    name,
    use: {
      viewport: { width, height },
      hasTouch: touch,
      isMobile: touch,
    },
  })),
  webServer: {
    env: { KOMA_E2E: 'true', DISABLE_HMR: 'true' },
    command: process.env.KOMA_E2E_PREVIEW === 'true'
      ? `npm run preview -- --host=127.0.0.1 --port=${port} --strictPort`
      : `npm run dev:e2e -- --port=${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
