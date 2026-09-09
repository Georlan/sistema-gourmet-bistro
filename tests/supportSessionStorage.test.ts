import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const modal = readFileSync('src/super-admin/SuperAdminSupportModal.tsx', 'utf8');
const banner = readFileSync('src/components/app/SupportSessionBanner.tsx', 'utf8');

test('modo suporte novo grava contexto somente na sessão do navegador', () => {
  assert.match(modal, /sessionStorage\.setItem\(\s*SUPPORT_SESSION_STORAGE_KEY/);
  assert.match(modal, /localStorage\.removeItem\(SUPPORT_SESSION_STORAGE_KEY\)/);
  assert.doesNotMatch(modal, /localStorage\.setItem\(\s*SUPPORT_SESSION_STORAGE_KEY/);
});

test('banner migra contexto legado para sessionStorage e apaga cópia durável', () => {
  assert.match(banner, /sessionStorage\.getItem\(SUPPORT_SESSION_STORAGE_KEY\)/);
  assert.match(banner, /localStorage\.getItem\(SUPPORT_SESSION_STORAGE_KEY\)/);
  assert.match(banner, /sessionStorage\.setItem\(SUPPORT_SESSION_STORAGE_KEY, legacy\)/);
  assert.match(banner, /localStorage\.removeItem\(SUPPORT_SESSION_STORAGE_KEY\)/);
});

test('encerramento limpa contexto temporário em ambos os storages', () => {
  assert.match(banner, /sessionStorage\.removeItem\(SUPPORT_SESSION_STORAGE_KEY\)/);
  assert.match(banner, /localStorage\.removeItem\(SUPPORT_SESSION_STORAGE_KEY\)/);
  assert.match(banner, /clearOperatorSession\(\)/);
});
