/**
 * Configurações comerciais e de contato para a Landing Page Oficial do KÔMA.
 */
export const KOMA_LANDING_CONFIG = {
  // Número do WhatsApp oficial (formatado para wa.me/55...)
  whatsappNumber: '5588999999999',
  whatsappMessage: encodeURIComponent('Olá! Vim pela página oficial do KÔMA e gostaria de agendar uma demonstração do sistema para meu restaurante.'),

  // Links de CTA
  demoAnchor: '#demonstracao',

  get whatsappUrl() {
    return `https://wa.me/${this.whatsappNumber}?text=${this.whatsappMessage}`;
  }
};
