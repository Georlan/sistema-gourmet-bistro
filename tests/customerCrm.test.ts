import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildManualWhatsAppUrl,
  filterCrmCustomersAdvanced,
  interpolateCrmTemplate,
  matchesCustomerSegment,
  selectCrmCustomers,
} from '../src/domain/customerCrm';
import type { LoyaltyCustomer } from '../src/components/caixa/cashierContracts';
const make = (id: string, count: number, days: number | null, total = 0): LoyaltyCustomer => ({ id, cliente: id, telefone: '85999998888', pontos: 0, saldoCashback: 0, pedidos_concluidos: count, dias_sem_comprar: days, valor_pago_total: total, segmento_relacionamento: days === null ? 'SEM_COMPRA' : days > 60 ? 'REATIVAR' : days > 30 ? 'ATENCAO' : 'ATIVO' });
const customers = [make('Zero', 0, null), make('Recente', 1, 0, 50), make('Fiel', 8, 70, 400), make('Outro', 8, 3, 600)];
test('ranking puts repeat buyers before unpurchased registrations without mutating snapshot', () => {
  assert.deepEqual(selectCrmCustomers(customers, '', 'ALL', 'orders').map(c => c.id), ['Outro', 'Fiel', 'Recente', 'Zero']);
  assert.equal(customers[0].id, 'Zero');
});
test('missing purchase dates stay last for both recency and inactivity', () => {
  assert.equal(selectCrmCustomers(customers, '', 'ALL', 'recent').at(-1)?.id, 'Zero');
  assert.equal(selectCrmCustomers(customers, '', 'ALL', 'absent')[0].id, 'Fiel');
  assert.equal(selectCrmCustomers(customers, '', 'ALL', 'absent').at(-1)?.id, 'Zero');
});
test('search by formatted phone composes with relationship filters', () => {
  assert.deepEqual(selectCrmCustomers(customers, '(85) 99999-8888', 'REATIVAR', 'orders').map(c => c.id), ['Fiel']);
  assert.equal(selectCrmCustomers(customers, 'zz', 'ALL', 'orders').length, 0);
  assert.equal(selectCrmCustomers(customers, '', 'REPEAT', 'orders').length, 2);
});

test('opportunities respect boundaries and never infer activity from registrations', () => {
  for (const days of [6, 30]) assert.equal(matchesCustomerSegment(make('one', 1, days), 'SECOND'), true);
  for (const days of [0, 5, 31, null]) assert.equal(matchesCustomerSegment(make('one', 1, days), 'SECOND'), false);
  assert.equal(matchesCustomerSegment({ ...make('balance', 2, 31), pontos: 10 }, 'BALANCE'), true);
  assert.equal(matchesCustomerSegment({ ...make('zero', 0, null), pontos: 10 }, 'BALANCE'), false);
  assert.equal(matchesCustomerSegment({ ...make('rhythm', 3, 8), intervalo_medio_dias: 4 }, 'CADENCE'), true);
  assert.equal(matchesCustomerSegment({ ...make('rhythm', 3, 6), intervalo_medio_dias: 4 }, 'CADENCE'), false);
  assert.equal(matchesCustomerSegment({ ...make('same-day', 8, 8), intervalo_medio_dias: 0 }, 'CADENCE'), false);
  assert.equal(matchesCustomerSegment(make('unknown', 3, 50), 'CADENCE'), false);
});

test('advanced CRM filters compose recency, frequency, value, product, redeemable benefit, and contact cooldown', () => {
  const richCustomers: LoyaltyCustomer[] = [
    {
      ...make('Mariana', 1, 14, 89),
      produtos_favoritos: [{ produto_id: 'p1', nome: 'Risoto de Camarão', unidades: 1 }],
      status_beneficio: 'SEM_SALDO',
      telefone_valido_whatsapp: true,
    },
    {
      ...make('Helena', 2, 20, 140),
      pontos: 10,
      elegivel_resgate: false,
      status_beneficio: 'SALDO_EM_FORMACAO',
      telefone_valido_whatsapp: true,
    },
    {
      ...make('Roberto', 5, 18, 450),
      pontos: 150,
      elegivel_resgate: true,
      beneficio_disponivel: '150 pts (equiv. R$ 7,50)',
      status_beneficio: 'RESGATAVEL',
      contato_recente: true,
      telefone_valido_whatsapp: true,
    },
    {
      ...make('OptOut', 3, 12, 210),
      opt_out_marketing: true,
      telefone_valido_whatsapp: true,
    },
  ];

  assert.deepEqual(
    filterCrmCustomersAdvanced(richCustomers, { productQuery: 'risoto' }).map((c) => c.id),
    ['Mariana'],
  );
  assert.deepEqual(
    filterCrmCustomersAdvanced(richCustomers, { benefitStatus: 'SALDO_EM_FORMACAO' }).map((c) => c.id),
    ['Helena'],
  );
  assert.deepEqual(
    filterCrmCustomersAdvanced(richCustomers, { benefitStatus: 'RESGATAVEL' }).map((c) => c.id),
    ['Roberto'],
  );
  assert.deepEqual(
    filterCrmCustomersAdvanced(richCustomers, { contactStatus: 'DISPONIVEL_ABORDAGEM' }).map((c) => c.id),
    ['Helena', 'Mariana'],
  );
  assert.deepEqual(
    filterCrmCustomersAdvanced(richCustomers, { contactStatus: 'CONTATO_RECENTE' }).map((c) => c.id),
    ['Roberto'],
  );
  assert.deepEqual(
    filterCrmCustomersAdvanced(richCustomers, { contactStatus: 'OPT_OUT' }).map((c) => c.id),
    ['OptOut'],
  );
});

test('template interpolation applies known data and safe fallbacks when fields are missing', () => {
  const tpl = 'Oi, {nome}! Que tal pedir {produto_favorito} usando {beneficio}?';
  assert.equal(
    interpolateCrmTemplate(tpl, {
      nome: 'Mariana Costa',
      produtos_favoritos: [{ produto_id: '1', nome: 'Risoto', unidades: 2 }],
      elegivel_resgate: true,
      beneficio_disponivel: 'R$ 12,00 de cashback',
    }),
    'Oi, Mariana! Que tal pedir Risoto usando R$ 12,00 de cashback?',
  );
  assert.equal(
    interpolateCrmTemplate(tpl, {
      nome: 'Cliente',
      produtos_favoritos: [],
      elegivel_resgate: false,
      beneficio_disponivel: '10 pts (saldo em formação)',
    }),
    'Oi, tudo bem? Que tal pedir seu prato preferido da casa usando uma condição especial para o seu próximo pedido?',
  );
});

test('buildManualWhatsAppUrl validates Brazilian phone numbers and rejects invalid phones', () => {
  assert.equal(
    buildManualWhatsAppUrl('(85) 99911-2233', 'Oi Mariana!'),
    'https://wa.me/5585999112233?text=Oi%20Mariana!',
  );
  assert.equal(buildManualWhatsAppUrl('12345', 'Oi'), null);
  assert.equal(buildManualWhatsAppUrl('85999999999', 'Oi'), null);
  assert.equal(buildManualWhatsAppUrl('georlan', 'Oi'), null);
});
