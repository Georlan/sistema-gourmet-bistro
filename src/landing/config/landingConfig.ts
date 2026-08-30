export interface LeadSelection {
  plan: string;
  billing: 'mensal' | 'anual';
}

export interface LeadFormData {
  responsavel: string;
  estabelecimento: string;
  whatsapp?: string;
  tipoOperacao?: string;
  tamanhoOperacao?: string;
}

/**
 * Configurações comerciais e de contato para a Landing Page Oficial do KÔMA.
 */
export const KOMA_LANDING_CONFIG = {
  // Número do WhatsApp oficial (formatado para wa.me/55...)
  whatsappNumber: '5588999616937',
  whatsappMessage: encodeURIComponent('Olá! Vim pela página do KÔMA e quero conhecer o sistema para meu restaurante. Podemos conversar?'),

  // Links de CTA
  signupAnchor: '#cadastro',

  // Quando houver um vídeo real de operação, informe a URL pública aqui.
  // Enquanto estiver vazio, a seção exibe uma demonstração guiada por WhatsApp.
  proofVideoUrl: '',

  get whatsappUrl() {
    return `https://wa.me/${this.whatsappNumber}?text=${this.whatsappMessage}`;
  },

  getLeadMessage(lead: LeadFormData, selection?: LeadSelection) {
    return [
      'Olá! Quero uma demonstração do KÔMA, sem compromisso.',
      '',
      `Responsável: ${lead.responsavel.trim()}`,
      `Estabelecimento: ${lead.estabelecimento.trim()}`,
      ...(lead.whatsapp?.trim() ? [`WhatsApp: ${lead.whatsapp.trim()}`] : []),
      ...(lead.tipoOperacao ? [`Tipo de operação: ${lead.tipoOperacao}`] : []),
      ...(lead.tamanhoOperacao ? [`Tamanho da operação: ${lead.tamanhoOperacao}`] : []),
      ...(selection ? [`Plano de interesse: ${selection.plan} · cobrança ${selection.billing}`] : []),
      '',
      'Quero entender se o sistema se encaixa na minha operação.',
    ].join('\n');
  },

  getLeadWhatsappUrl(lead: LeadFormData, selection?: LeadSelection) {
    return `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(this.getLeadMessage(lead, selection))}`;
  }
};
