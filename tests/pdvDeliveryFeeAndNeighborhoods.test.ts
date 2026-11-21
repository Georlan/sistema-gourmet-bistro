import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getDeliveryQuote } from '../src/cardapio/deliveryPresentation';

test('PDV calcula taxa de entrega por bairro cadastrado e frete grátis igual ao cardápio online', () => {
  const config = {
    freteGratisValor: 60,
    tipoTaxaEntrega: 'bairro',
    taxaEntregaPadrao: 2,
    tabelaTaxasBairros: [
      { bairro: 'Limoeirinho', taxa: 4 },
      { bairro: 'Centro', taxa: 3 },
    ],
  };

  assert.equal(getDeliveryQuote(config, 20, '').fee, 2);
  assert.equal(getDeliveryQuote(config, 20, 'limoeirinho').fee, 4);
  assert.equal(getDeliveryQuote(config, 20, 'Centro').fee, 3);
  assert.equal(getDeliveryQuote(config, 60, 'Limoeirinho').fee, 0);
});

test('PDV expõe bairros cadastrados no endereço compacto e exibe taxa de entrega no resumo do pedido', () => {
  const fieldsSource = readFileSync(
    new URL('../src/components/shared/DeliveryAddressFields.tsx', import.meta.url),
    'utf8',
  );
  const hookSource = readFileSync(
    new URL('../src/components/caixa/pdv/useCashierPdv.ts', import.meta.url),
    'utf8',
  );
  const viewSource = readFileSync(
    new URL('../src/components/caixa/pdv/CashierPdvView.tsx', import.meta.url),
    'utf8',
  );

  assert.match(fieldsSource, /\{neighborhoodOptions\.length > 0 && \(/);
  assert.doesNotMatch(fieldsSource, /neighborhoodOptions\.length > 0 && !compact/);
  assert.match(hookSource, /fetchCardapioDigitalConfig/);
  assert.match(hookSource, /getDeliveryQuote/);
  assert.match(hookSource, /pdvNeighborhoodOptions/);
  assert.match(hookSource, /pdvDeliveryFee/);
  assert.match(viewSource, /neighborhoodOptions=\{pdvNeighborhoodOptions\}/);
  assert.match(viewSource, /Taxa de entrega/);
});
