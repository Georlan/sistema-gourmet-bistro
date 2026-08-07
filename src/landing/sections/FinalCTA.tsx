import React from 'react';
import logoImg from '../../assets/logo-koma.png';

export function FinalCTA() {
  return (
    <>
      <section
        className="koma-cta-final"
        id="demonstracao"
        aria-label="Solicitar demonstração"
      >
        <h2 className="koma-section-title" style={{ color: '#0a0a0a' }}>
          Conheça<br />o KÔMA.
        </h2>

        <a href="mailto:contato@koma.com.br" className="koma-btn koma-btn--dark">
          Solicitar demonstração
        </a>

        <img src={logoImg} alt="KÔMA" className="koma-cta-logo" />
      </section>

      <footer className="koma-footer" role="contentinfo">
        <span>© {new Date().getFullYear()} KÔMA. Todos os direitos reservados.</span>
        <span>Sistema de gestão para restaurantes</span>
      </footer>
    </>
  );
}
