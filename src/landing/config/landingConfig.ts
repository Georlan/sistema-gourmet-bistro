/**
 * Configurações comerciais e de contato para a Landing Page Oficial do KÔMA.
 */
export const KOMA_LANDING_CONFIG = {
  // Número do WhatsApp oficial (formatado para wa.me/55...)
  whatsappNumber: '5588999616937',
  whatsappMessage: encodeURIComponent('Olá! Vim pela página oficial do KÔMA e quero saber como iniciar o cadastro do meu restaurante.'),

  // Links de CTA
  signupAnchor: '#cadastro',

  // Quando houver um vídeo real de operação, informe a URL pública aqui.
  // Enquanto estiver vazio, a seção exibe uma demonstração guiada por WhatsApp.
  proofVideoUrl: '',

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
      'Olá! Quero iniciar o cadastro do meu restaurante no KÔMA.',
      '',
      `Responsável: ${lead.responsavel.trim()}`,
      `Estabelecimento: ${lead.estabelecimento.trim()}`,
      `WhatsApp: ${lead.whatsapp.trim()}`,
      `Tipo de operação: ${lead.tipoOperacao}`,
      `Tamanho da operação: ${lead.tamanhoOperacao}`,
      '',
      'Quero saber quais são os próximos passos para começar.',
    ].join('\n');

    return `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(message)}`;
  }
};
