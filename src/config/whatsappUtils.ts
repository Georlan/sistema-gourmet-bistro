/**
 * Utilitários de Comunicação WhatsApp via Links Diretos (wa.me) para o Sistema Kôma
 */

/**
 * Higienização do número de telefone mantendo apenas dígitos e prefixo do país (55)
 * Ex: "(88) 99961-6937" -> "5588999616937"
 */
export function formatWhatsAppPhone(phone?: string | null): string {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Disparo direto via link wa.me em nova aba sem dependências externas de API
 */
export function openWhatsAppMessage(phone?: string | null, text?: string): boolean {
  const cleanPhone = formatWhatsAppPhone(phone);
  if (!cleanPhone) {
    alert('Número de WhatsApp inválido ou não informado.');
    return false;
  }
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text || '')}`;
  window.open(url, '_blank');
  return true;
}

// -------------------------------------------------------------
// TEMPLATES DE MENSAGENS PADRONIZADAS DO KÔMA
// -------------------------------------------------------------

/**
 * Template 1: Confirmação de Pedido
 */
export function buildPedidoConfirmadoMsg(nome: string, itensStr: string, totalVal: number | string): string {
  const clienteNome = (nome || '').trim() || 'Cliente';
  const totalStr = typeof totalVal === 'number' ? totalVal.toFixed(2) : totalVal;
  return `Olá, ${clienteNome}! Seu pedido no *Kôma* foi recebido.\n\n*Resumo:* ${itensStr}\n*Total:* R$ ${totalStr}\n\nAcompanhe o status do seu pedido!`;
}

/**
 * Template 2: Pedido Pronto para Retirada / Saiu para Entrega
 */
export function buildStatusUpdateMsg(nome: string, isDelivery: boolean): string {
  const clienteNome = (nome || '').trim() || 'Cliente';
  const acao = isDelivery ? 'SAIU PARA ENTREGA' : 'ESTÁ PRONTO PARA RETIRADA';
  return `Olá, ${clienteNome}! Seu pedido no *Kôma* ${acao}.`;
}

/**
 * Template 3: Chave Pix para Pagamento
 */
export function buildPixMsg(nome: string, chavePix: string, valorVal: number | string): string {
  const clienteNome = (nome || '').trim() || 'Cliente';
  const valorStr = typeof valorVal === 'number' ? valorVal.toFixed(2) : valorVal;
  return `Olá, ${clienteNome}! Segue a chave Pix para pagamento do seu pedido no *Kôma*:\n\n*Chave Pix:* ${chavePix}\n*Valor:* R$ ${valorStr}`;
}
