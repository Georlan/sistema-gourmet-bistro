import React, { useState } from 'react';
import { KOMA_SLOGAN, KOMA_WORDMARK_ON_LIGHT_SRC } from '../../brand/komaBrand';
import { KomaLogo } from '../../components/KomaLogo';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

export function FinalCTA() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <>
      <section
        className="koma-cta-section"
        id="cadastro"
        aria-label="Começar cadastro no Kôma"
      >
        <span className="koma-cta-kicker">06 / PRÓXIMO PASSO</span>
        <div className="koma-cta-brand-signature">
          <img
            src={KOMA_WORDMARK_ON_LIGHT_SRC}
            className="koma-cta-wordmark"
            alt=""
            aria-hidden="true"
          />
          <span className="koma-cta-slogan">Se você está com fome, <strong>Kôma</strong></span>
        </div>
        <h2 className="koma-cta-title">
          VEJA O KÔMA<br /><em>EM AÇÃO.</em>
        </h2>

        <p className="koma-cta-sub">
          Leva menos de um minuto pelo WhatsApp.
        </p>

        <div className="koma-cta-actions">
          <button
            type="button"
            className="koma-btn koma-btn--dark"
            onClick={() => setLeadModalOpen(true)}
          >
            <WhatsAppIcon />
            Iniciar cadastro
          </button>
          <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon />
            PREFIRO FALAR DIRETO NO WHATSAPP
          </a>
        </div>
      </section>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />

      <footer className="koma-footer" role="contentinfo">
        <a href="/landing" aria-label="Kôma, início" className="koma-footer-brand">
          <KomaLogo size="md" variant="dark" />
          <span>{KOMA_SLOGAN}</span>
        </a>
        <span>© {new Date().getFullYear()} KÔMA. TODOS OS DIREITOS RESERVADOS.</span>
        <nav aria-label="Navegação do rodapé">
          <a href="#como-funciona">Como funciona</a>
          <a href="#duvidas">Dúvidas</a>
          <a href="#planos">Planos</a>
        </nav>
      </footer>
    </>
  );
}
