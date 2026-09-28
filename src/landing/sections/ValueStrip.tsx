import React from 'react';

const without = ['Pedido anotado', 'Repasse ao preparo', 'Conferência do status', 'Fechamento com registros separados'];
const withKoma = ['Pedido registrado', 'Atendimento e preparo acompanham', 'Consumo e histórico permanecem no pedido'];
export function ValueStrip() {
  return <section className="v2-section v2-comparison" aria-labelledby="compare-title">
    <div className="v2-wrap">
      <div className="v2-section-heading" data-reveal><p className="v2-eyebrow">Um fluxo acompanhado</p><h2 id="compare-title">Um pedido. Menos etapas para conferir.</h2><p>Um exemplo de atendimento com registros separados, comparado ao fluxo acompanhado no KÔMA.</p></div>
      <div className="v2-lanes">
        <article className="v2-lane" data-reveal><h3>Sem KÔMA <span>— exemplo</span></h3><ol>{without.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span>{step}</li>)}</ol></article>
        <article className="v2-lane v2-lane--koma" data-reveal><h3>Com KÔMA</h3><ol>{withKoma.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span>{step}</li>)}</ol></article>
      </div>
      <a className="v2-text-link" href="#como-funciona">Ver as telas <span aria-hidden="true">↗</span></a>
    </div>
  </section>;
}
