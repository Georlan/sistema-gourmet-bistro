import React from 'react';
import { ArrowUpRight, Play } from 'lucide-react';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

export function SocialProof() {
  return (
    <section className="koma-proof-section" id="credibilidade" aria-labelledby="proof-title">
      <div className="koma-proof-heading">
        <span>02 / POR QUE O KÔMA EXISTE</span>
        <h2 id="proof-title">CRIADO PARA A<br />OPERAÇÃO REAL.</h2>
      </div>

      <div className="koma-proof-grid">
        <figure className="koma-founder-quote">
          <blockquote>
            “Eu criei o Kôma para que o dono não precise descobrir o que aconteceu no restaurante só no fim do expediente. A informação precisa chegar enquanto ainda dá tempo de agir.”
          </blockquote>
          <figcaption>
            <strong>GEORLAN GOMES</strong>
            <span>FUNDADOR DO KÔMA</span>
          </figcaption>
        </figure>

        <div className="koma-proof-demo">
          {KOMA_LANDING_CONFIG.proofVideoUrl ? (
            <video controls preload="metadata" playsInline aria-label="Demonstração do Kôma em uma operação real">
              <source src={KOMA_LANDING_CONFIG.proofVideoUrl} />
            </video>
          ) : (
            <div className="koma-proof-demo-fallback">
              <Play aria-hidden="true" />
              <span>DEMONSTRAÇÃO GUIADA</span>
              <strong>VEJA O FLUXO FUNCIONANDO ANTES DE DECIDIR.</strong>
              <p>Mostramos o Kôma com situações parecidas com as do seu restaurante, sem compromisso.</p>
              <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">
                Pedir demonstração <ArrowUpRight aria-hidden="true" />
              </a>
            </div>
          )}
        </div>
      </div>

      <div className="koma-proof-principles" aria-label="Compromissos do Kôma">
        <span><b>01</b> PRODUTO EM VALIDAÇÃO CONTÍNUA</span>
        <span><b>02</b> FLUXOS BASEADOS NA ROTINA DO RESTAURANTE</span>
        <span><b>03</b> CONTATO DIRETO DURANTE A IMPLANTAÇÃO</span>
      </div>
    </section>
  );
}
