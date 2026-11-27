import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicImportProductId,
  inferCategoryPrintDestination,
  parseMenuImportText,
} from '../src/domain/menuImportParser';

test('parses WhatsApp structured menu with categories, descriptions and smart beverage routing', () => {
  const sample = `
*HAMBÚRGUERES*
X-Burguer Especial - R$ 24,90
Pão brioche, blend 160g e queijo cheddar
X-Bacon (Pão, carne, bacon crocante) - 29,50

BEBIDAS:
Coca-Cola Lata 350ml - R$ 6,00
Suco Natural de Laranja .... R$ 9,50
Água sem gás
  `;

  const parsed = parseMenuImportText(sample);
  assert.equal(parsed.format, 'whatsapp_text');
  assert.equal(parsed.items.length, 5);

  const xBurguer = parsed.items[0];
  assert.equal(xBurguer.nome, 'X-Burguer Especial');
  assert.equal(xBurguer.preco, 24.9);
  assert.equal(xBurguer.descricao, 'Pão brioche, blend 160g e queijo cheddar');
  assert.equal(xBurguer.destinoImpressao, 'COZINHA');
  assert.equal(xBurguer.needsReview, false);

  const xBacon = parsed.items[1];
  assert.equal(xBacon.nome, 'X-Bacon');
  assert.equal(xBacon.preco, 29.5);
  assert.equal(xBacon.descricao, 'Pão, carne, bacon crocante');

  const coca = parsed.items[2];
  assert.equal(coca.categoriaNome, 'BEBIDAS');
  assert.equal(coca.destinoImpressao, 'NENHUM');

  // Line without price is never invented — flagged for review with 0
  const agua = parsed.items[4];
  assert.equal(agua.nome, 'Água sem gás');
  assert.equal(agua.preco, 0);
  assert.equal(agua.needsReview, true);
  assert.equal(parsed.warnings.length, 1);
});

test('parses Excel/Sheets tab-delimited and semicolon CSV with header mapping', () => {
  const tsv = [
    'Nome\tPreço\tCategoria\tDescrição',
    'Pastel de Carne\t12,50\tPastéis\tCarne moída temperada',
    'Caldo de Cana\t8.00\tBebidas\t500ml gelado',
  ].join('\n');

  const parsed = parseMenuImportText(tsv);
  assert.equal(parsed.format, 'tabular');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].preco, 12.5);
  assert.equal(parsed.items[0].categoriaNome, 'Pastéis');
  assert.equal(parsed.items[0].destinoImpressao, 'COZINHA');
  assert.equal(parsed.items[1].preco, 8);
  assert.equal(parsed.items[1].destinoImpressao, 'NENHUM');
});

test('generates deterministic product IDs and classifies beverages accurately', () => {
  const id1 = buildDeterministicImportProductId('X-Salada', 'cat-lanches');
  const id2 = buildDeterministicImportProductId('X-Salada', 'cat-lanches');
  assert.equal(id1, id2);
  assert.ok(id1.startsWith('imp-x-salada-'));
  assert.equal(inferCategoryPrintDestination('Sucos e Refrigerantes'), 'NENHUM');
  assert.equal(inferCategoryPrintDestination('Pizzas Tradicionais'), 'COZINHA');
});
