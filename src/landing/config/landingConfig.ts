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

  // Links de CTA
  signupAnchor: '#cadastro',

  // Quando houver um vídeo real de operação, informe a URL pública aqui.
  // Enquanto estiver vazio, a seção exibe uma solicitação de demonstração.
  proofVideoUrl: '',

  get whatsappUrl() {
    return `https://wa.me/${this.whatsappNumber}`;
  },

};
