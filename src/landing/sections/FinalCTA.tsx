import React, { useState } from 'react';
import logoOnDark from '../../assets/logo-koma-on-dark.png';
import logoOnGreen from '../../assets/logo-koma-on-green.png';
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
        <span className="koma-cta-kicker">07 / PRONTO PARA ORGANIZAR SUA OPERAÇÃO?</span>
        <div className="koma-cta-brand-signature">
          <img src={logoOnGreen} alt="" aria-hidden="true" />
          <span>Se você está com fome, <strong>Kôma</strong></span>
        </div>
        <h2 className="koma-cta-title">
          MENOS CORRERIA.<br /><em>MAIS CONTROLE.</em>
        </h2>

        <p className="koma-cta-sub">
          Conte como seu restaurante funciona. Nós mostramos o encaixe, verificamos os equipamentos e orientamos os próximos passos.
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
          <img src={logoOnDark} alt="" />
          <span>Se você está com fome, Kôma</span>
        </a>
        <span>© {new Date().getFullYear()} KÔMA. TODOS OS DIREITOS RESERVADOS.</span>
        <nav aria-label="Navegação do rodapé">
          <a href="#como-funciona">Como funciona</a>
          <a href="#modulos">Recursos</a>
          <a href="#duvidas">Dúvidas</a>
          <a href="#planos">Planos</a>
        </nav>
      </footer>
    </>
  );
}
