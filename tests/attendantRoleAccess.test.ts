import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('attendant is a six-card team role focused on quick orders', () => {
  const people = source('../src/components/equipe/EquipePessoasTab.tsx');
  const roles = source('../src/components/equipe/teamRoles.ts');

  assert.match(
    people,
    /INVITABLE_ROLES = \['garcom', 'atendente', 'caixa', 'cozinha', 'gerente', 'motoboy'\]/,
  );
  assert.match(roles, /atendente:[\s\S]*label: 'Atendente'/);
  assert.match(roles, /Registra pedidos de balcão, retirada e atendimento rápido\./);
});

test('attendant login preserves its role and opens the dedicated quick-order surface', () => {
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  const session = source('../src/utils/authSession.ts');
  const app = source('../src/App.tsx');
  const attendant = source('../src/components/AttendantPanel.tsx');

  assert.match(entry, /role === 'atendente'/);
  assert.match(session, /role === 'atendente'/);
  assert.match(app, /activeRole === 'atendente'[\s\S]*<AttendantPanel/);
  assert.match(app, /MANAGEMENT_ROLES = new Set<AppRole>\(\['admin', 'gerente', 'caixa'\]\)/);
  assert.doesNotMatch(app, /MANAGEMENT_ROLES = new Set<AppRole>\([^\n]*atendente/);

  assert.match(attendant, /<CashierPdvView/);
  assert.match(attendant, /activeSubTab="balcao"/);
  assert.match(attendant, /activeTab: 'operacao'/);
  assert.match(attendant, /activeSubTab: 'balcao'/);
  assert.doesNotMatch(attendant, /CashierDesktopSidebar|CashierMobileSidebar|CaixaPanel/);
});

test('attendant stays on quick order after submit instead of navigating into cashier orders', () => {
  const attendant = source('../src/components/AttendantPanel.tsx');
  assert.match(attendant, /keepQuickOrderTab/);
  assert.match(attendant, /keepQuickOrderSubTab/);
  assert.match(attendant, /setActiveTab: keepQuickOrderTab/);
  assert.match(attendant, /setActiveSubTab: keepQuickOrderSubTab/);
});
