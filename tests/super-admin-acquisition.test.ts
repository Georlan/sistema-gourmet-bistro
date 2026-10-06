import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const route = fs.readFileSync('backend/app/routes/super_admin_acquisition.py', 'utf8');
const panel = fs.readFileSync('src/super-admin/SuperAdminPanel.tsx', 'utf8');
const checkout = fs.readFileSync('src/cardapio/components/CardapioDigital.tsx', 'utf8');

test('aquisição é protegida pelo SuperAdmin e não expõe PII de consumidor', () => {
  assert.match(route, /Depends\(get_current_admin\)/);
  assert.doesNotMatch(route, /cliente_nome|cliente_telefone|delivery_endereco/);
  assert.match(panel, /SuperAdminAcquisitionTab/);
});

test('checkout envia atribuição sem expor painel de aquisição ao cardápio', () => {
  assert.match(checkout, /getOrderAttribution\(targetRestauranteId\)/);
  assert.doesNotMatch(checkout, /SuperAdminAcquisitionTab/);
});
