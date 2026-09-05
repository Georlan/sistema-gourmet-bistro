import test from 'node:test';
import assert from 'node:assert/strict';

import { isValidCnpj, isValidCpf, normalizeTaxId, taxIdKind } from '../src/legal/taxId';


test('validação de CPF rejeita sequências e aceita dígitos verificadores válidos', () => {
  assert.equal(normalizeTaxId('529.982.247-25'), '52998224725');
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(taxIdKind('529.982.247-25'), 'cpf');
  assert.equal(isValidCpf('000.000.000-00'), false);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('529.982.247-24'), false);
});


test('validação de CNPJ rejeita sequências e aceita dígitos verificadores válidos', () => {
  assert.equal(normalizeTaxId('11.222.333/0001-81'), '11222333000181');
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(taxIdKind('11.222.333/0001-81'), 'cnpj');
  assert.equal(isValidCnpj('00.000.000/0000-00'), false);
  assert.equal(isValidCnpj('11.111.111/1111-11'), false);
  assert.equal(isValidCnpj('11.222.333/0001-80'), false);
});
