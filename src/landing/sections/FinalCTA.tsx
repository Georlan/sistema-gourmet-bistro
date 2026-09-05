import React from 'react';
import { ArrowDownRight, Check, MessageCircle } from 'lucide-react';
import { KOMA_SLOGAN, KOMA_WORDMARK_ON_LIGHT_SRC } from '../../brand/komaBrand';
import { KomaLogo } from '../../components/KomaLogo';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { useLeadCapture } from '../components/LeadCaptureProvider';

const NEXT_STEPS = [
  'Escolha o plano e o período de cobrança.',
  'Leia os documentos e informe os dados do responsável.',
  'Conclua a ativação do restaurante.',
] as const;

export function FinalCTA() {
  const openDemo = useLeadCapture();

  return (
    <>
      <section className="koma-final-conversion" id="cadastro" aria-labelledby="final-title">
        <div className="koma-final-conversion-copy">
          <span>07 / PRÓXIMO PASSO</span>
          <h2 id="final-title">PRONTO PARA COMEÇAR?</h2>
          <p>Escolha o plano que faz sentido para a sua operação ou peça uma demonstração antes de decidir.</p>

          <div className="koma-final-conversion-actions">
            <a href="/landing#planos" className="koma-btn koma-btn--primary">
              ESCOLHER MEU PLANO <ArrowDownRight size={17} aria-hidden="true" />
            </a>
            <button type="button" className="koma-btn koma-btn--outline-dark" onClick={() => openDemo()}>
              QUERO VER UMA DEMONSTRAÇÃO
            </button>
            <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon /> PREFIRO FALAR DIRETO
            </a>
          </div>
          <small>Contratação transparente, documentos públicos e sem taxa de implantação.</small>
        </div>

        <aside className="koma-final-next" aria-label="O que acontece depois">
          <img src={KOMA_WORDMARK_ON_LIGHT_SRC} alt="Kôma" />
          <div>
            <span><MessageCircle size={17} aria-hidden="true" /> CONTRATAÇÃO ONLINE</span>
            <ol>
              {NEXT_STEPS.map((step, index) => (
                <li key={step}><b>{String(index + 1).padStart(2, '0')}</b><p>{step}</p><Check size={18} aria-hidden="true" /></li>
              ))}
            </ol>
          </div>
          <strong>SEM SURPRESA NO PREÇO. SEM TERMOS ESCONDIDOS.</strong>
        </aside>
      </section>

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
          <a href="/legal">Legal e privacidade</a>
          <a href="/legal/termos">Termos</a>
          <a href="/legal/privacidade">Privacidade</a>
        </nav>
      </footer>
    </>
  );
}
