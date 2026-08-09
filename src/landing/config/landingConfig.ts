/**
 * Configurações comerciais e de contato para a Landing Page Oficial do KÔMA.
 */
export const KOMA_LANDING_CONFIG = {
  // Número do WhatsApp oficial (formatado para wa.me/55...)
  whatsappNumber: '5588999616937',
  whatsappMessage: encodeURIComponent('Olá! Vim pela página oficial do KÔMA e gostaria de agendar uma demonstração do sistema para meu restaurante.'),

  // Links de CTA
  demoAnchor: '#demonstracao',

  get whatsappUrl() {
    return `https://wa.me/${this.whatsappNumber}?text=${this.whatsappMessage}`;
  },

  getLeadWhatsappUrl(lead: {
    responsavel: string;
    estabelecimento: string;
    whatsapp: string;
    tipoOperacao: string;
    tamanhoOperacao: string;
  }) {
    const message = [
      'Olá! Quero ver o KÔMA funcionando na minha operação.',
      '',
      `Responsável: ${lead.responsavel.trim()}`,
      `Estabelecimento: ${lead.estabelecimento.trim()}`,
      `WhatsApp: ${lead.whatsapp.trim()}`,
      `Tipo de operação: ${lead.tipoOperacao}`,
      `Tamanho da operação: ${lead.tamanhoOperacao}`,
      '',
      'Gostaria de agendar uma demonstração.',
    ].join('\n');

    return `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(message)}`;
  }
};
