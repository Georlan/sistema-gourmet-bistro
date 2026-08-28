import React from 'react';
import { ProductPreview } from '../components/ProductPreview';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

const BENEFITS = [
  'Pedido registrado uma vez',
  'Salão e cozinha sincronizados',
  'Caixa e impressão no mesmo fluxo',
];

export function Hero({ onOpenLead }: { onOpenLead: () => void }) {
  return (
    <section className="koma-hero" aria-labelledby="hero-title">
      <div className="koma-hero-glow" aria-hidden="true" />
      <div className="koma-container koma-hero-layout">
        <div className="koma-hero-copy">
          <p className="koma-eyebrow"><span />Gestão para restaurantes, bares e lanchonetes</p>
          <h1 id="hero-title">Seu restaurante inteiro. <em>Um só fluxo.</em></h1>
          <p className="koma-hero-lead">
            O pedido entra uma vez e segue por salão, cozinha, impressão, caixa e cardápio digital — sem sua equipe precisar redigitar ou correr atrás da informação.
          </p>

          <ul className="koma-hero-benefits">
            {BENEFITS.map((benefit) => <li key={benefit}><i aria-hidden="true">✓</i>{benefit}</li>)}
          </ul>

          <div className="koma-hero-actions">
            <button type="button" className="koma-btn koma-btn--primary" onClick={onOpenLead}>Agendar demonstração</button>
            <a href="#produto" className="koma-btn koma-btn--ghost">Ver o produto <span aria-hidden="true">↓</span></a>
          </div>

          <p className="koma-hero-note">
            <WhatsAppIcon /> Conversa inicial sem custo. Você revisa tudo antes de enviar.
          </p>
        </div>

        <div className="koma-hero-product">
          <div className="koma-hero-product-label"><i aria-hidden="true" />Operação ao vivo</div>
          <ProductPreview view="salon" className="koma-hero-preview" />
          <div className="koma-hero-event koma-hero-event--kitchen">
            <span>COZINHA</span>
            <strong>Pedido #128 recebido</strong>
            <small>Itens e observações já chegaram</small>
          </div>
          <div className="koma-hero-event koma-hero-event--cashier">
            <span>CAIXA</span>
            <strong>Mesa 02 atualizada</strong>
            <small>Total e status sincronizados</small>
          </div>
        </div>
      </div>

      <div className="koma-container koma-hero-proof" aria-label="O que você confirma antes de contratar">
        <span>Antes de contratar:</span>
        <strong>Veja o sistema com a sua rotina</strong>
        <strong>Confirme seus equipamentos</strong>
        <strong>Planeje a implantação</strong>
        <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer">Falar com o Kôma <span aria-hidden="true">↗</span></a>
      </div>
    </section>
  );
}
