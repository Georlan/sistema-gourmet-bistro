type ValidationIssue = {
  loc?: unknown;
  msg?: unknown;
  type?: unknown;
};

const FIELD_LABELS: Record<string, string> = {
  restaurante_id: 'Restaurante',
  cliente_nome: 'Nome',
  cliente_telefone: 'Telefone',
  cliente_email: 'E-mail',
  endereco_entrega: 'Endereço',
  taxa_entrega: 'Taxa de entrega',
  forma_pagamento: 'Forma de pagamento',
  forma_pagamento_detalhe: 'Forma de pagamento',
  tipo_pedido: 'Tipo do pedido',
  scheduled_for: 'Agendamento',
  itens: 'Itens do pedido',
  produto_id: 'Produto',
  quantidade: 'Quantidade',
  address_snapshot: 'Endereço',
  street: 'Rua',
  number: 'Número',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'UF',
  postal_code: 'CEP',
  complement: 'Complemento',
  reference: 'Referência',
};

const normalizeLocation = (raw: unknown): Array<string | number> => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
    .filter((part) => part !== 'body');
};

const labelForLocation = (raw: unknown): string => {
  const location = normalizeLocation(raw);
  if (location.length === 0) return 'Dados do pedido';

  const itemIndex = location.findIndex((part) => part === 'itens');
  if (itemIndex >= 0 && typeof location[itemIndex + 1] === 'number') {
    const itemNumber = Number(location[itemIndex + 1]) + 1;
    const leaf = String(location[location.length - 1]);
    const leafLabel = FIELD_LABELS[leaf] || 'Dados';
    return `Item ${itemNumber} — ${leafLabel}`;
  }

  const leaf = String(location[location.length - 1]);
  return FIELD_LABELS[leaf] || leaf.replaceAll('_', ' ');
};

const messageForIssue = (issue: ValidationIssue): string => {
  const type = String(issue.type || '').toLowerCase();
  if (type.includes('missing')) return 'campo obrigatório.';
  if (type.includes('string_too_short') || type.includes('too_short')) return 'preenchimento incompleto.';
  if (type.includes('string_too_long') || type.includes('too_long')) return 'texto maior que o permitido.';
  if (type.includes('greater_than') || type.includes('greater_than_equal')) return 'valor abaixo do permitido.';
  if (type.includes('less_than') || type.includes('less_than_equal')) return 'valor acima do permitido.';
  if (type.includes('literal') || type.includes('enum')) return 'opção inválida.';
  if (type.includes('int') || type.includes('float') || type.includes('decimal')) return 'valor numérico inválido.';

  const rawMessage = typeof issue.msg === 'string' ? issue.msg.trim() : '';
  if (rawMessage && /[áàâãéêíóôõúç]/i.test(rawMessage)) {
    return rawMessage.endsWith('.') ? rawMessage : `${rawMessage}.`;
  }
  return 'valor inválido.';
};

export function formatCardapioApiError(
  payload: unknown,
  fallback = 'Não foi possível registrar o pedido. Tente novamente.',
): string {
  if (!payload || typeof payload !== 'object') return fallback;

  const record = payload as Record<string, unknown>;
  const detail = record.detail;

  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .filter((item): item is ValidationIssue => Boolean(item) && typeof item === 'object')
      .map((issue) => `${labelForLocation(issue.loc)}: ${messageForIssue(issue)}`);
    if (messages.length > 0) {
      return `Revise os dados do pedido: ${messages.slice(0, 3).join(' ')}`;
    }
  }

  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim();
  return fallback;
}
