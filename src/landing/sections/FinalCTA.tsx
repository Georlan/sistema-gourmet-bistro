import React from 'react';
import { KOMA_SLOGAN, KOMA_WORDMARK_ON_DARK_SRC } from '../../brand/komaBrand';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

export function FinalCTA({ onOpenLead }: { onOpenLead: () => void }) {
  return (
    <>
      <section className="koma-final-section" id="cadastro" aria-labelledby="final-title">
        <div className="koma-final-pattern" aria-hidden="true" />
        <div className="koma-container koma-final-content">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="Kôma" />
          <p className="koma-eyebrow"><span />Próximo passo</p>
          <h2 id="final-title">Veja o Kôma com<br /><em>a sua operação.</em></h2>
          <p>Conte como seu restaurante funciona. Mostramos o fluxo adequado, confirmamos seus equipamentos e explicamos os próximos passos.</p>
          <div>
            <button type="button" className="koma-btn koma-btn--primary" onClick={onOpenLead}>Agendar demonstração</button>
            <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer" className="koma-btn koma-btn--light-ghost"><WhatsAppIcon /> Falar no WhatsApp</a>
          </div>
          <small>Conversa inicial sem custo e sem envio automático de dados.</small>
        </div>
      </section>

      <footer className="koma-footer" role="contentinfo">
        <div className="koma-container">
          <a href="/landing" aria-label="Kôma, início"><img src={KOMA_WORDMARK_ON_DARK_SRC} alt="Kôma" /><span>{KOMA_SLOGAN}</span></a>
          <p>© {new Date().getFullYear()} Kôma. Todos os direitos reservados.</p>
          <nav aria-label="Navegação do rodapé"><a href="#produto">Produto</a><a href="#planos">Planos</a><a href="#duvidas">Dúvidas</a></nav>
        </div>
      </footer>
    </>
  );
}
