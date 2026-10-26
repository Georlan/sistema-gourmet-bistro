import { resolveStaffDestination } from '../src/utils/staffDestination';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('kitchen role is invitable and unified login opens the KDS role path', () => {
  const people = source('../src/components/equipe/EquipePessoasTab.tsx');
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  const authSession = source('../src/utils/authSession.ts');
  const app = source('../src/App.tsx');

  assert.match(
    people,
    /INVITABLE_ROLES = \['garcom', 'atendente', 'caixa', 'cozinha', 'gerente', 'motoboy'\]/,
  );
  assert.equal(resolveStaffDestination('cozinha'), 'caixa');
  assert.match(entry, /parseStaffLogin/);
  assert.match(authSession, /resolveOperationalPortal/);
  assert.match(app, /activeRole === 'cozinha'[\s\S]*<KitchenPanel/);
});
