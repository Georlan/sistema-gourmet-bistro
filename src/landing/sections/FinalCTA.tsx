import React, { useState } from 'react';
import { ArrowDownRight, Check, MessageCircle } from 'lucide-react';
import { KOMA_SLOGAN, KOMA_WORDMARK_ON_LIGHT_SRC } from '../../brand/komaBrand';
import { KomaLogo } from '../../components/KomaLogo';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const NEXT_STEPS = [
  'Você conta como seu restaurante funciona.',
  'Nós mostramos o fluxo e o plano que fazem sentido.',
  'Você decide se e quando quer continuar.',
] as const;

export function FinalCTA() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <>
      <section className="koma-final-conversion" id="cadastro" aria-labelledby="final-title">
        <div className="koma-final-conversion-copy">
          <span>09 / PRÓXIMO PASSO</span>
          <h2 id="final-title">VEJA MENOS CORRERIA NA PRÁTICA.</h2>
          <p>Conte o essencial sobre sua operação e receba uma demonstração focada no que realmente precisa melhorar.</p>

          <div className="koma-final-conversion-actions">
            <button type="button" className="koma-btn koma-btn--primary" onClick={() => setLeadModalOpen(true)}>
              SOLICITAR DEMONSTRAÇÃO <ArrowDownRight size={17} aria-hidden="true" />
            </button>
            <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon /> PREFIRO FALAR DIRETO
            </a>
          </div>
          <small>Sem compromisso. Você escolhe como continuar.</small>
        </div>

        <aside className="koma-final-next" aria-label="O que acontece depois">
          <img src={KOMA_WORDMARK_ON_LIGHT_SRC} alt="Kôma" />
          <div>
            <span><MessageCircle size={17} aria-hidden="true" /> O QUE ACONTECE AGORA</span>
            <ol>
              {NEXT_STEPS.map((step, index) => (
                <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><p>{step}</p><Check size={18} aria-hidden="true" /></li>
              ))}
            </ol>
          </div>
          <strong>CLAREZA PRIMEIRO. DECISÃO DEPOIS.</strong>
        </aside>
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
