import React from 'react';
import logoImg from '../../assets/logo-koma.png';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

export function FinalCTA() {
  return (
    <>
      <section
        className="koma-cta-section"
        id="demonstracao"
        aria-label="Solicitar demonstração"
      >
        <span className="koma-cta-kicker">PRONTO PARA VER NA SUA OPERAÇÃO?</span>
        <h2 className="koma-cta-title">
          SEU RESTAURANTE.<br /><em>UM SÓ FLUXO.</em>
        </h2>

        <p className="koma-cta-sub">
          Conte como seu restaurante funciona. A demonstração mostra como o Kôma pode organizar a sua rotina.
        </p>

        <div className="koma-cta-actions">
          <a
            href={KOMA_LANDING_CONFIG.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="koma-btn koma-btn--dark"
          >
            Falar com um especialista ↗
          </a>
          <span>RESPOSTA DIRETA PELO WHATSAPP</span>
        </div>
      </section>

      <footer className="koma-footer" role="contentinfo">
        <a href="/landing" aria-label="Kôma — início"><img src={logoImg} alt="" /></a>
        <span>© {new Date().getFullYear()} KÔMA. TODOS OS DIREITOS RESERVADOS.</span>
        <nav aria-label="Navegação do rodapé">
          <a href="#como-funciona">Como funciona</a>
          <a href="#gestao">Gestão</a>
          <a href="#planos">Planos</a>
        </nav>
      </footer>
    </>
  );
}
