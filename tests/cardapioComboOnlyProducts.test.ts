import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const get = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('snapshot mantém itens de promoções fora das categorias avulsas', () => {
  const routes = get('../backend/app/routes/cardapio_digital.py');
  assert.match(routes, /Produto\.somente_promocao\.is_\(False\)/);
  assert.match(routes, /products_regular = \[product for product in produtos if not product\.somente_promocao\]/);
  assert.match(routes, /produtos_promocionais/);
  assert.match(routes, /referenced_special_ids/);
});

test('cardápio só utiliza produtos exclusivos dentro do assistente de promoção', () => {
  const page = get('../src/cardapio/CardapioPage.tsx');
  assert.match(page, /payload\.produtos\.map\(mapPublicProduct\)/);
  assert.match(page, /payload\.produtos_promocionais \|\| \[\]/);
  assert.match(page, /promotionProducts,/);
  assert.match(page, /\.\.\.\(activeBrand\.promotionProducts \|\| \[\]\)/);
});

test('o cadastro permite escolher exclusividade sem criar outro tamanho de quentinha', () => {
  const editor = get('../src/components/caixa/catalog/CashierCatalog.tsx');
  const setup = get('../src/components/cardapio/MarmitariaPromotionsSettings.tsx');
  assert.match(editor, /Vender somente em promoções/);
  assert.match(editor, /somente_promocao: isMarmitaria && prodFormSomentePromocao/);
  assert.match(setup, /Criar bebida apenas para promoções/);
  assert.match(setup, /somente_promocao: true/);
  assert.match(setup, /products\.some\(p => p\.nome/);
  assert.match(setup, /preco: price/);
});
