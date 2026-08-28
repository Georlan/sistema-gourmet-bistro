import React from 'react';

const GROUPS = [
  {
    num: '01',
    eyebrow: 'VENDER',
    title: 'VENDA POR ONDE O CLIENTE CHEGAR.',
    text: 'Salão, balcão, retirada, delivery e cardápio digital alimentam a mesma operação.',
    features: ['PDV, mesas e comandas', 'Retirada e delivery', 'Cardápio digital e QR Code'],
  },
  {
    num: '02',
    eyebrow: 'OPERAR',
    title: 'TODO MUNDO NO MESMO FLUXO.',
    text: 'O pedido segue do atendimento à produção sem depender de novos repasses manuais.',
    features: ['Salão atualizado ao vivo', 'KDS e impressão automática', 'Status compartilhado pela equipe'],
  },
  {
    num: '03',
    eyebrow: 'CONTROLAR',
    title: 'DECIDA COM O HISTÓRICO NA MÃO.',
    text: 'Caixa, estoque, relatórios, equipe e relacionamento ficam ligados ao que realmente aconteceu.',
    features: ['Caixa e financeiro', 'Estoque e relatórios', 'CRM, fidelidade e cupons'],
  },
];

export function Management() {
  return (
    <section className="koma-management-section" id="gestao" aria-labelledby="management-title">
      <div className="koma-section-heading koma-section-heading--light">
        <span>03 / TRÊS PILARES</span>
        <h2 id="management-title">VENDER. OPERAR.<br />CONTROLAR.</h2>
        <p>Três objetivos simples organizam tudo o que o Kôma entrega para o restaurante.</p>
      </div>

      <div className="koma-management-grid">
        {GROUPS.map((group) => (
          <article className="koma-management-card" key={group.num}>
            <div className="koma-management-card-top">
              <span>{group.num}</span>
              <small>{group.eyebrow}</small>
            </div>
            <h3>{group.title}</h3>
            <p>{group.text}</p>
            <ul>
              {group.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
