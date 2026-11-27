import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseExpressOnboardingText } from '../src/domain/expressOnboardingParser';

describe('expressOnboardingParser', () => {
  it('interpreta texto estruturado completo de pizzaria com atendimento, horário e cardápio sem inventar dados ausentes', () => {
    const sample = `
Nome: Pizzaria Don Romano
Segmento: Pizzaria
Atendimento: Delivery, Retirada
Horário: 18h às 23h
Cardápio:
Pizzas Tradicionais:
Calabresa - R$ 49,90
Marguerita - R$ 47,90
Portuguesa - R$ 52,90
Bebidas:
Coca-Cola 2L - R$ 14,00
`.trim();

    const result = parseExpressOnboardingText(sample);

    assert.equal(result.fields.name, 'Pizzaria Don Romano');
    assert.equal(result.fields.slug, 'pizzaria-don-romano');
    assert.equal(result.fields.operationProfile, 'pizzaria');
    assert.equal(result.fields.segmentPreset, 'pizzaria');
    assert.deepEqual(result.fields.orderTypes, ['delivery', 'retirada']);
    assert.deepEqual(result.fields.operatingHours, [
      { days: 'Todos os dias', hours: '18:00 - 23:00' },
    ]);
    assert.equal(result.menuItems.length, 4);
    assert.equal(result.menuItems[0].category, 'Pizzas Tradicionais');
    assert.equal(result.menuItems[0].price, 49.9);
    assert.equal(result.menuItems[3].printDestination, 'NENHUM');

    // Nunca inventa admin_name nem admin_email quando ausentes
    assert.equal(result.fields.adminName, '');
    assert.equal(result.fields.adminEmail, '');
    assert.deepEqual(result.missingRequiredFields, ['admin_name', 'admin_email']);
  });

  it('reconhece JSON estruturado e múltiplos turnos de horário', () => {
    const jsonInput = JSON.stringify({
      nome: 'Marmitaria Sabor Real',
      segmento: 'Marmitaria / PF',
      responsavel: 'Ana Silva',
      email: 'ana@saborreal.com.br',
      whatsapp: '(85) 99999-1234',
      atendimento: 'delivery, retirada, salao',
      horario: 'seg a sex 11:00 - 15:00; sab e dom 11:30 - 14:30',
      menu_items: [
        { name: 'Executivo Frango', price: 24.9, category: 'Pratos Executivos' },
      ],
    });

    const result = parseExpressOnboardingText(jsonInput);

    assert.equal(result.fields.name, 'Marmitaria Sabor Real');
    assert.equal(result.fields.operationProfile, 'marmitaria');
    assert.equal(result.fields.segmentPreset, 'marmitaria');
    assert.equal(result.fields.adminName, 'Ana Silva');
    assert.equal(result.fields.adminEmail, 'ana@saborreal.com.br');
    assert.equal(result.fields.phone, '85999991234');
    assert.deepEqual(result.fields.orderTypes, ['delivery', 'retirada', 'consumo_local']);
    assert.deepEqual(result.fields.operatingHours, [
      { days: 'Segunda a Sexta', hours: '11:00 - 15:00' },
      { days: 'Sábado e Domingo', hours: '11:30 - 14:30' },
    ]);
    assert.deepEqual(result.missingRequiredFields, []);
    assert.equal(result.menuItems.length, 1);
  });

  it('sinaliza linha de cardápio sem preço sem inventar valor', () => {
    const sample = `
Nome: Burger Teste
Responsável: Carlos
Email: carlos@teste.com
Cardápio:
Hambúrgueres:
X-Bacon Especial
X-Salada - R$ 28,50
`.trim();

    const result = parseExpressOnboardingText(sample);

    assert.deepEqual(result.missingRequiredFields, []);
    assert.equal(result.menuItems.length, 1);
    assert.equal(result.menuItems[0].name, 'X-Salada');
    assert.equal(result.warnings.length, 1);
  });
});
