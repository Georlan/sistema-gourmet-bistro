import React from 'react';

const GROUPS = [
  {
    num: '01',
    eyebrow: 'OPERAÇÃO',
    title: 'O DIA SOB CONTROLE.',
    text: 'Pedidos, mesas, balcão, cardápio e disponibilidade em uma visão operacional.',
    features: ['Mesas e comandas', 'Balcão e retirada', 'Produtos e categorias'],
  },
  {
    num: '02',
    eyebrow: 'GESTÃO',
    title: 'DECISÃO COM CONTEXTO.',
    text: 'Caixa, estoque, relatórios e equipe organizados para quem precisa decidir.',
    features: ['Turnos e movimentações', 'Estoque e fornecedores', 'Relatórios e desempenho'],
  },
  {
    num: '03',
    eyebrow: 'RELACIONAMENTO',
    title: 'CLIENTE NÃO É SÓ UM PEDIDO.',
    text: 'Histórico, cupons e fidelidade ajudam a construir recorrência sem separar a operação.',
    features: ['Base de clientes', 'Cupons', 'Programa de fidelidade'],
  },
];

export function Management() {
  return (
    <section className="koma-management-section" id="gestao" aria-labelledby="management-title">
      <div className="koma-section-heading koma-section-heading--light">
        <span>05 / ALÉM DO PEDIDO</span>
        <h2 id="management-title">GESTÃO QUE<br />NÃO ATRAPALHA.</h2>
        <p>O essencial aparece primeiro. O detalhe continua disponível quando você precisa.</p>
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
