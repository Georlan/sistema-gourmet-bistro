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
    /INVITABLE_ROLES = \['garcom', 'caixa', 'cozinha', 'gerente', 'motoboy'\]/,
  );
  assert.match(entry, /role === 'cozinha' \|\| MANAGEMENT_ROLES\.has\(role\)/);
  assert.match(
    authSession,
    /role === 'admin' \|\| role === 'gerente' \|\| role === 'caixa' \|\| role === 'cozinha'/,
  );
  assert.match(app, /activeRole === 'cozinha'[\s\S]*<KitchenPanel/);
});
