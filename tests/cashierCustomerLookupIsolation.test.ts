import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyCustomerState,
  handleCustomerPhoneUpdate,
  handleCustomerLookupSuccess,
  handleCustomerLookupNotFound,
  handleCustomerLookupError,
  handleOrderTypeSwitch,
  handleManualAddressUpdate,
  handleOrderSubmissionRecovery,
} from '../src/components/caixa/pdv/cashierCustomerLookup';
import { formatDeliveryAddressLegacy, type DeliveryAddressDraft } from '../src/domain/deliveryAddress';

test('1. Defeito reproduzido: troca de telefone com cliente reconhecido mantinha dados anteriores no 404', () => {
  // Estado inicial vazio
  let state = createEmptyCustomerState();

  // Operador digita Telefone A (11) 98765-4321
  state = handleCustomerPhoneUpdate(state, '(11) 98765-4321');
  assert.equal(state.normalizedPhone, '11987654321');
  assert.equal(state.lookupStatus, 'loading');

  // Lookup responde 200 com Cliente A (Carlos Silva, ID 101, Rua das Flores 123)
  state = handleCustomerLookupSuccess(
    state,
    {
      id: 101,
      cliente: 'Carlos Silva',
      endereco: 'Rua das Flores, 123 - Centro',
      telefone: '11987654321',
    },
    '11987654321',
    true, // delivery
  );

  assert.equal(state.customerId, '101');
  assert.equal(state.name, 'Carlos Silva');
  assert.equal(state.deliveryAddress, 'Rua das Flores, 123 - Centro');
  assert.equal(state.lookupStatus, 'found');
  assert.equal(state.recognizedBinding?.phone, '11987654321');

  // Operador altera o telefone para Telefone B (11) 99999-8888 (não cadastrado)
  state = handleCustomerPhoneUpdate(state, '(11) 99999-8888');
  assert.equal(state.normalizedPhone, '11999998888');

  // COMPORTAMENTO CORRIGIDO:
  // Ao trocar o telefone, dados do Cliente A foram desacoplados e limpos imediatamente!
  assert.equal(state.customerId, null, 'customerId deve ser limpo ao trocar o telefone');
  assert.equal(state.name, '', 'Nome de Carlos Silva não deve vazar para o novo telefone');
  assert.equal(state.deliveryAddress, '', 'Endereço de Carlos Silva não deve vazar para o novo telefone');
  assert.equal(state.recognizedBinding, null, 'Binding com Telefone A deve ser nulo');

  // Lookup responde 404 para Telefone B
  state = handleCustomerLookupNotFound(state, '11999998888');
  assert.equal(state.lookupStatus, 'new');
  assert.equal(state.customerId, null);
  assert.equal(state.name, '');
  assert.equal(state.deliveryAddress, '');
});

test('2. Cenário obrigatório: Telefone A encontrado -> trocar para Telefone B cadastrado', () => {
  let state = createEmptyCustomerState();

  // Cliente A encontrado
  state = handleCustomerPhoneUpdate(state, '(11) 98765-4321');
  state = handleCustomerLookupSuccess(
    state,
    { id: '101', cliente: 'Carlos Silva', endereco: 'Rua A, 1', telefone: '11987654321' },
    '11987654321',
    true,
  );
  assert.equal(state.name, 'Carlos Silva');
  assert.equal(state.customerId, '101');

  // Troca para Telefone B
  state = handleCustomerPhoneUpdate(state, '(11) 99999-8888');
  assert.equal(state.name, '');
  assert.equal(state.customerId, null);

  // Cliente B encontrado
  state = handleCustomerLookupSuccess(
    state,
    { id: '202', cliente: 'Mariana Costa', endereco: 'Av B, 200', telefone: '11999998888' },
    '11999998888',
    true,
  );
  assert.equal(state.name, 'Mariana Costa');
  assert.equal(state.customerId, '202');
  assert.equal(state.deliveryAddress, 'Av B, 200');
  assert.equal(state.lookupStatus, 'found');
  assert.equal(state.recognizedBinding?.phone, '11999998888');
});

test('3. Cenário obrigatório: Resposta assíncrona obsoleta descartada quando o telefone mudou', () => {
  let state = createEmptyCustomerState();

  // Digita Telefone A (requisição disparada em background)
  state = handleCustomerPhoneUpdate(state, '(11) 98765-4321');

  // Antes de A responder, operador digita Telefone B
  state = handleCustomerPhoneUpdate(state, '(11) 99999-8888');
  assert.equal(state.normalizedPhone, '11999998888');

  // Resposta de A chega com atraso (race condition)
  state = handleCustomerLookupSuccess(
    state,
    { id: '101', cliente: 'Carlos Silva', endereco: 'Rua A, 1' },
    '11987654321', // Telefone solicitado foi A
    true,
  );

  // Deve ter ignorado a resposta de A
  assert.equal(state.name, '', 'Não deve aceitar resposta de telefone anterior');
  assert.equal(state.customerId, null);
  assert.equal(state.recognizedBinding, null);
});

test('4. Cenário obrigatório: Edição manual legítima após preenchimento automático é preservada', () => {
  let state = createEmptyCustomerState();

  state = handleCustomerPhoneUpdate(state, '(11) 98765-4321');
  state = handleCustomerLookupSuccess(
    state,
    { id: '101', cliente: 'Carlos Silva', endereco: 'Rua A, 1' },
    '11987654321',
    true,
  );

  // Operador edita manualmente o nome para 'Carlos Silva Jr.'
  state = { ...state, name: 'Carlos Silva Jr.' };

  // Operador edita manualmente o endereço
  const editedDraft: DeliveryAddressDraft = {
    logradouro: 'Rua A',
    numero: '1',
    complemento: 'Apto 42B',
    bairro: 'Centro',
    cidade: 'Fortaleza',
    uf: 'CE',
    cep: '60000-000',
    referencia: 'Portão azul',
  };
  state = handleManualAddressUpdate(state, editedDraft);

  // O telefone não mudou: cliente continua reconhecido e com as edições manuais
  assert.equal(state.customerId, '101');
  assert.equal(state.name, 'Carlos Silva Jr.');
  assert.match(state.deliveryAddress, /Apto 42B/);
  assert.equal(state.recognizedBinding?.customerId, '101');
});

test('5. Cenário obrigatório: Preserva digitação manual prévia quando número novo é 404', () => {
  let state = createEmptyCustomerState();

  // Operador digita o nome primeiro manualmente (ex: retirada de balcão)
  state = { ...state, name: 'Lucas Manual' };
  assert.equal(state.recognizedBinding, null);

  // Em seguida digita telefone novo (ainda não cadastrado)
  state = handleCustomerPhoneUpdate(state, '(11) 97777-6666');

  // Não apaga a digitação manual de Lucas, pois não veio de outro cliente
  assert.equal(state.name, 'Lucas Manual');

  // 404 chega: Lucas continua no campo
  state = handleCustomerLookupNotFound(state, '11977776666');
  assert.equal(state.name, 'Lucas Manual');
  assert.equal(state.lookupStatus, 'new');
});

test('6. Cenário obrigatório: Telefone incompleto após reconhecimento anterior limpa dados associados', () => {
  let state = createEmptyCustomerState();

  state = handleCustomerPhoneUpdate(state, '(11) 98765-4321');
  state = handleCustomerLookupSuccess(
    state,
    { id: '101', cliente: 'Carlos Silva', endereco: 'Rua A, 1' },
    '11987654321',
    true,
  );
  assert.equal(state.customerId, '101');

  // Operador apaga dígitos, deixando o telefone incompleto (ex: 4 dígitos)
  state = handleCustomerPhoneUpdate(state, '1198');
  assert.equal(state.normalizedPhone, '1198');
  assert.equal(state.customerId, null);
  assert.equal(state.name, '');
  assert.equal(state.deliveryAddress, '');
  assert.equal(state.lookupStatus, 'idle');
  assert.equal(state.recognizedBinding, null);
});

test('7. Cenário obrigatório: Restauração após erro de submissão do pedido (retry resiliente)', () => {
  // Simula estado que estava sendo submetido
  const savedForm = {
    phone: '(11) 98765-4321',
    name: 'Carlos Silva',
    customerId: '101',
    deliveryAddress: 'Rua das Flores, 123',
    deliveryAddressDraft: {
      logradouro: 'Rua das Flores',
      numero: '123',
      complemento: '',
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
      cep: '',
      referencia: '',
    },
    deliveryAddressLegacyHint: '',
  };

  // Erro 500 ou queda de conexão no envio
  const restored = handleOrderSubmissionRecovery(savedForm);

  assert.equal(restored.phone, '(11) 98765-4321');
  assert.equal(restored.name, 'Carlos Silva');
  assert.equal(restored.customerId, '101');
  assert.equal(restored.deliveryAddress, 'Rua das Flores, 123');
  assert.equal(restored.lookupStatus, 'found');
  assert.equal(restored.recognizedBinding?.customerId, '101');
  assert.equal(restored.recognizedBinding?.phone, '11987654321');
});

test('8. Cenário obrigatório: Alternância de modalidade preserva ou hidrata dados conforme o tipo', () => {
  let state = createEmptyCustomerState();

  // Reconhecido em Retirada
  state = handleCustomerPhoneUpdate(state, '(11) 98765-4321');
  state = handleCustomerLookupSuccess(
    state,
    { id: '101', cliente: 'Carlos Silva', endereco: 'Rua das Flores, 123' },
    '11987654321',
    false, // pickup (não hidrata endereço de entrega ainda)
  );

  assert.equal(state.name, 'Carlos Silva');
  assert.equal(state.deliveryAddress, '');

  // Operador muda modalidade para Delivery (F8)
  state = handleOrderTypeSwitch(state, 'delivery');
  assert.equal(state.deliveryAddress, 'Rua das Flores, 123', 'Deve hidratar endereço salvo ao mudar para delivery');

  // Operador muda modalidade para Consumo no Local (F3)
  state = handleOrderTypeSwitch(state, 'dine_in');
  assert.equal(state.customerId, null);
  assert.equal(state.lookupStatus, 'idle');
});
