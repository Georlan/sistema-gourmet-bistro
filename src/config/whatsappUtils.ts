/**
 * Contato voluntário iniciado pelo cliente via link direto (wa.me).
 * Notificações operacionais são enviadas pelo backend através da Evolution API.
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
 * Abre uma conversa somente após uma ação explícita do cliente.
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

/** Mensagem opcional do cliente ao falar com o restaurante sobre o pedido. */
export function buildPedidoConfirmadoMsg(nome: string, itensStr: string, totalVal: number | string): string {
  const clienteNome = (nome || '').trim() || 'Cliente';
  const totalStr = typeof totalVal === 'number' ? totalVal.toFixed(2) : totalVal;
  return `Olá, ${clienteNome}! Seu pedido no *Kôma* foi recebido.\n\n*Resumo:* ${itensStr}\n*Total:* R$ ${totalStr}\n\nAcompanhe o status do seu pedido!`;
}
