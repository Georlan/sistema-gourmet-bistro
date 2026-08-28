/**
 * Configurações comerciais e de contato para a Landing Page Oficial do KÔMA.
 */
export const KOMA_LANDING_CONFIG = {
  // Número do WhatsApp oficial (formatado para wa.me/55...)
  whatsappNumber: '5588999616937',
  whatsappMessage: encodeURIComponent('Olá! Vim pela página oficial do KÔMA e quero ver uma demonstração para o meu restaurante.'),

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
  }) {
    const message = [
      'Olá! Quero ver uma demonstração do KÔMA para o meu restaurante.',
      '',
      `Responsável: ${lead.responsavel.trim()}`,
      `Estabelecimento: ${lead.estabelecimento.trim()}`,
      `WhatsApp: ${lead.whatsapp.trim()}`,
      `Tipo de operação: ${lead.tipoOperacao || 'Prefiro explicar na conversa'}`,
      '',
      'Quero entender como o sistema se encaixa na minha rotina.',
    ].join('\n');

    return `https://wa.me/${this.whatsappNumber}?text=${encodeURIComponent(message)}`;
  }
};
