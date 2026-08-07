import React from 'react';
import logoImg from '../../assets/logo-koma.png';

export function FinalCTA() {
  return (
    <>
      <section
        className="koma-cta-section"
        id="demonstracao"
        aria-label="Solicitar demonstração"
      >
        <h2 className="koma-cta-title">
          CONHEÇA<br />O KÔMA.
        </h2>

        <p className="koma-cta-sub">
          Transforme a operação do seu restaurante hoje.<br />
          Do salão à cozinha, sem ruído.
        </p>

        <a href="mailto:contato@koma.com.br" className="koma-btn koma-btn--dark">
          Solicitar demonstração
        </a>
      </section>

      <footer className="koma-footer" role="contentinfo">
        <span>© {new Date().getFullYear()} KÔMA. TODOS OS DIREITOS RESERVADOS.</span>
        <span>SISTEMA DE GESTÃO PARA RESTAURANTES</span>
      </footer>
    </>
  );
}
