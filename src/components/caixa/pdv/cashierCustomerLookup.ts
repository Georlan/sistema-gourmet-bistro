import {
  EMPTY_DELIVERY_ADDRESS,
  type DeliveryAddressDraft,
  deliveryAddressDraftToSnapshot,
  formatDeliveryAddressLegacy,
  parseDeliveryAddressLegacy,
} from '../../../domain/deliveryAddress';

export type CustomerLookupStatus = 'idle' | 'loading' | 'found' | 'new';

export type CustomerLookupRecord = {
  id: string | number;
  cliente?: string;
  nome?: string;
  endereco?: string | null;
  telefone?: string;
};

export type RecognizedCustomerBinding = {
  phone: string; // normalizado (somente dígitos)
  customerId: string;
  name: string;
  address: string | null;
};

export type CustomerSessionState = {
  phone: string;
  normalizedPhone: string;
  name: string;
  customerId: string | null;
  deliveryAddress: string;
  deliveryAddressDraft: DeliveryAddressDraft;
  deliveryAddressLegacyHint: string;
  lookupStatus: CustomerLookupStatus;
  recognizedBinding: RecognizedCustomerBinding | null;
};

export const emptyDeliveryAddressDraft = (): DeliveryAddressDraft => ({
  ...EMPTY_DELIVERY_ADDRESS,
});

export const createEmptyCustomerState = (): CustomerSessionState => ({
  phone: '',
  normalizedPhone: '',
  name: '',
  customerId: null,
  deliveryAddress: '',
  deliveryAddressDraft: emptyDeliveryAddressDraft(),
  deliveryAddressLegacyHint: '',
  lookupStatus: 'idle',
  recognizedBinding: null,
});

/**
 * Atualiza o telefone do cliente no PDV, garantindo que dados reconhecidos
 * de um cliente anterior (nome, ID, endereço) NÃO vazem para o novo número.
 * Preserva campos digitados manualmente sem associação a cliente anterior.
 */
export function handleCustomerPhoneUpdate(
  prev: CustomerSessionState,
  newPhoneFormatted: string,
): CustomerSessionState {
  const newNormalized = newPhoneFormatted.replace(/\D/g, '');

  // Se havia um cliente reconhecido associado a outro telefone:
  // desvincula e limpa nome e endereço reconhecidos para evitar contaminação cruzada.
  if (prev.recognizedBinding && prev.recognizedBinding.phone !== newNormalized) {
    const isNextComplete = newNormalized.length >= 10 && newNormalized.length <= 11;
    return {
      phone: newPhoneFormatted,
      normalizedPhone: newNormalized,
      name: '',
      customerId: null,
      deliveryAddress: '',
      deliveryAddressDraft: emptyDeliveryAddressDraft(),
      deliveryAddressLegacyHint: '',
      lookupStatus: isNextComplete ? 'loading' : 'idle',
      recognizedBinding: null,
    };
  }

  // Telefone incompleto ou com comprimento inválido:
  // limpa status de busca e customerId
  if (newNormalized.length < 10 || newNormalized.length > 11) {
    return {
      ...prev,
      phone: newPhoneFormatted,
      normalizedPhone: newNormalized,
      customerId: null,
      lookupStatus: 'idle',
      recognizedBinding: null,
    };
  }

  // Telefone de comprimento válido (10-11 dígitos), ainda não reconhecido
  return {
    ...prev,
    phone: newPhoneFormatted,
    normalizedPhone: newNormalized,
    customerId: prev.recognizedBinding?.phone === newNormalized ? prev.customerId : null,
    lookupStatus: prev.recognizedBinding?.phone === newNormalized ? 'found' : 'loading',
  };
}

/**
 * Aplica os dados retornados pela API de lookup para o telefone consultado.
 * Descarta respostas assíncronas obsoletas se o operador já tiver alterado o telefone.
 */
export function handleCustomerLookupSuccess(
  prev: CustomerSessionState,
  customer: CustomerLookupRecord,
  requestedPhoneNormalized: string,
  isDelivery: boolean,
): CustomerSessionState {
  // Guarda contra race condition: se o telefone atual mudou enquanto a requisição
  // estava em trânsito, a resposta antiga é descartada imediatamente.
  if (prev.normalizedPhone !== requestedPhoneNormalized) {
    return prev;
  }

  const customerId = String(customer.id);
  const customerName = String(customer.cliente || customer.nome || '').trim();
  const storedAddress = customer.endereco ? String(customer.endereco).trim() : null;

  let deliveryAddress = prev.deliveryAddress;
  let deliveryAddressDraft = prev.deliveryAddressDraft;
  let deliveryAddressLegacyHint = prev.deliveryAddressLegacyHint;

  if (isDelivery && storedAddress) {
    const parsed = parseDeliveryAddressLegacy(storedAddress);
    deliveryAddress = storedAddress;
    if (parsed) {
      deliveryAddressDraft = parsed;
      deliveryAddressLegacyHint = '';
    } else {
      deliveryAddressDraft = emptyDeliveryAddressDraft();
      deliveryAddressLegacyHint = storedAddress;
    }
  }

  return {
    ...prev,
    customerId,
    name: customerName || prev.name,
    deliveryAddress,
    deliveryAddressDraft,
    deliveryAddressLegacyHint,
    lookupStatus: 'found',
    recognizedBinding: {
      phone: requestedPhoneNormalized,
      customerId,
      name: customerName,
      address: storedAddress,
    },
  };
}

/**
 * Trata o retorno 404 (cliente não cadastrado) da busca por telefone.
 * Descarta respostas obsoletas e assegura que nenhum dado anterior permaneça vinculado.
 */
export function handleCustomerLookupNotFound(
  prev: CustomerSessionState,
  requestedPhoneNormalized: string,
): CustomerSessionState {
  if (prev.normalizedPhone !== requestedPhoneNormalized) {
    return prev;
  }

  // Se havia dados reconhecidos de um cliente diferente, eles já devem ter sido limpos;
  // se porventura o binding anterior ainda apontava para outro número, limpa explicitamente.
  const hadOtherBinding = prev.recognizedBinding && prev.recognizedBinding.phone !== requestedPhoneNormalized;

  return {
    ...prev,
    customerId: null,
    name: hadOtherBinding ? '' : prev.name,
    deliveryAddress: hadOtherBinding ? '' : prev.deliveryAddress,
    deliveryAddressDraft: hadOtherBinding ? emptyDeliveryAddressDraft() : prev.deliveryAddressDraft,
    deliveryAddressLegacyHint: hadOtherBinding ? '' : prev.deliveryAddressLegacyHint,
    lookupStatus: 'new',
    recognizedBinding: null,
  };
}

/**
 * Trata erros de rede/servidor durante o lookup sem destruir digitações manuais legítimas.
 */
export function handleCustomerLookupError(
  prev: CustomerSessionState,
  requestedPhoneNormalized: string,
): CustomerSessionState {
  if (prev.normalizedPhone !== requestedPhoneNormalized) {
    return prev;
  }

  return {
    ...prev,
    customerId: null,
    lookupStatus: 'idle',
    recognizedBinding: null,
  };
}

/**
 * Altera a modalidade do pedido (retirada / entrega / consumo local)
 * e hidrata o endereço caso o cliente já tenha sido reconhecido anteriormente.
 */
export function handleOrderTypeSwitch(
  prev: CustomerSessionState,
  newOrderType: 'pickup' | 'delivery' | 'dine_in',
): CustomerSessionState {
  if (newOrderType === 'dine_in') {
    return {
      ...prev,
      customerId: null,
      lookupStatus: 'idle',
      recognizedBinding: null,
    };
  }

  // Ao alternar para delivery com cliente já reconhecido que possui endereço salvo,
  // popula o endereço se o campo ainda estiver vazio.
  if (newOrderType === 'delivery' && prev.recognizedBinding?.address && !prev.deliveryAddress) {
    const storedAddress = prev.recognizedBinding.address;
    const parsed = parseDeliveryAddressLegacy(storedAddress);
    return {
      ...prev,
      deliveryAddress: storedAddress,
      deliveryAddressDraft: parsed || emptyDeliveryAddressDraft(),
      deliveryAddressLegacyHint: parsed ? '' : storedAddress,
    };
  }

  return prev;
}

/**
 * Atualiza o endereço de entrega manualmente pelo operador.
 */
export function handleManualAddressUpdate(
  prev: CustomerSessionState,
  nextDraft: DeliveryAddressDraft,
): CustomerSessionState {
  const snapshot = deliveryAddressDraftToSnapshot(nextDraft);
  const formatted = snapshot ? formatDeliveryAddressLegacy(snapshot) : '';
  return {
    ...prev,
    deliveryAddressDraft: nextDraft,
    deliveryAddressLegacyHint: '',
    deliveryAddress: formatted,
  };
}

/**
 * Restaura o estado completo do cliente no PDV após falha no lançamento do pedido,
 * permitindo retry sem perda de dados ou estado de identificação.
 */
export function handleOrderSubmissionRecovery(saved: {
  phone: string;
  name: string;
  customerId: string | null;
  deliveryAddress: string;
  deliveryAddressDraft: DeliveryAddressDraft;
  deliveryAddressLegacyHint: string;
}): CustomerSessionState {
  const normalized = saved.phone.replace(/\D/g, '');
  const isRecognized = Boolean(saved.customerId && normalized.length >= 10);

  return {
    phone: saved.phone,
    normalizedPhone: normalized,
    name: saved.name,
    customerId: saved.customerId,
    deliveryAddress: saved.deliveryAddress,
    deliveryAddressDraft: saved.deliveryAddressDraft,
    deliveryAddressLegacyHint: saved.deliveryAddressLegacyHint,
    lookupStatus: isRecognized ? 'found' : normalized.length >= 10 ? 'new' : 'idle',
    recognizedBinding: isRecognized
      ? {
          phone: normalized,
          customerId: saved.customerId!,
          name: saved.name,
          address: saved.deliveryAddress || null,
        }
      : null,
  };
}
