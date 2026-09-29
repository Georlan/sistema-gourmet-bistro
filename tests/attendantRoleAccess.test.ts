import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('attendant role is invitable and enters the dedicated quick-order workspace', () => {
  const people = source('../src/components/equipe/EquipePessoasTab.tsx');
  const roles = source('../src/components/equipe/teamRoles.ts');
  const entry = source('../src/components/auth/UnifiedOperationalEntry.tsx');
  const authSession = source('../src/utils/authSession.ts');
  const app = source('../src/App.tsx');
  const panel = source('../src/components/AttendantQuickOrderPanel.tsx');

  assert.match(
    people,
    /INVITABLE_ROLES = \['garcom', 'atendente', 'caixa', 'cozinha', 'gerente', 'motoboy'\]/,
  );
  assert.match(roles, /atendente:[\s\S]*Registra pedidos de balcão, retirada e atendimento rápido/);
  assert.match(entry, /role === 'atendente' \|\| role === 'cozinha'/);
  assert.match(authSession, /role === 'atendente'/);
  assert.match(app, /activeRole === 'atendente'[\s\S]*<AttendantQuickOrderPanel/);
  assert.match(panel, /ATTENDANT_ORDER_TYPES = \['pickup', 'delivery'\] as const/);
  assert.match(panel, /activeSubTab: 'balcao'/);
});

test('attendant quick-order workspace excludes table service and admin navigation', () => {
  const panel = source('../src/components/AttendantQuickOrderPanel.tsx');
  const pdv = source('../src/components/caixa/pdv/CashierPdvView.tsx');

  assert.doesNotMatch(panel, /CashierDesktopSidebar|CashierMobileSidebar|CashierSettings|CashierReports/);
  assert.match(pdv, /modalityOptions\.length === 2 \? 'grid-cols-2' : 'grid-cols-3'/);
  assert.match(pdv, /allowedPdvOrderTypes\.includes\('dine_in'\)/);
});
