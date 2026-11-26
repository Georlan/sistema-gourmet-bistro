import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readRepoFile = (relPath: string) =>
  readFileSync(new URL(`../${relPath}`, import.meta.url), 'utf8');

test('SuperAdminFoundersPanel implements 5-slot Founders management UI without emojis', () => {
  const src = readRepoFile('src/super-admin/SuperAdminFoundersPanel.tsx');
  assert.match(src, /\/api\/super-admin\/founders/);
  assert.match(src, /Conceder benefício Founders/);
  assert.match(src, /Confirmar revogação/);
  assert.match(src, /Vagas históricas não são reutilizáveis/);
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u);
});

test('SuperAdminBillingTab mounts SuperAdminFoundersPanel alongside SuperAdminFinance', () => {
  const src = readRepoFile('src/super-admin/SuperAdminBillingTab.tsx');
  assert.match(src, /import \{ SuperAdminFoundersPanel \} from "\.\/SuperAdminFoundersPanel";/);
  assert.match(src, /<SuperAdminFoundersPanel tenants=\{tenants\} \/>/);
});

test('SuperAdminFinance renders V2-B CFO indicators and preserves unknown-cost guard', () => {
  const src = readRepoFile('src/super-admin/SuperAdminFinance.tsx');
  assert.match(src, /MRR contratado/);
  assert.match(src, /ARPA \(pagantes\)/);
  assert.match(src, /Ponto de equilíbrio/);
  assert.match(src, /Margem de contribuição/);
  assert.match(src, /Custos incompletos/);
  assert.doesNotMatch(src, /[\u{1F300}-\u{1FAFF}]/u);
});
