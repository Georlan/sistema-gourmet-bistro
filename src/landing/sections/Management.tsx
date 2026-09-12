import React from 'react';
import { ChartNoAxesCombined, ShoppingBag, Workflow } from 'lucide-react';

const GROUPS = [
  {
    num: '01',
    slug: 'vender',
    eyebrow: 'VENDER',
    icon: ShoppingBag,
    title: 'ATENDA EM TODOS OS CANAIS.',
    text: 'Salão, balcão, retirada, delivery e cardápio digital alimentam a mesma operação.',
    features: ['PDV, mesas e comandas', 'Retirada e delivery', 'Cardápio digital e QR Code em todos os planos'],
  },
  {
    num: '02',
    slug: 'operar',
    eyebrow: 'OPERAR',
    icon: Workflow,
    title: 'AGILIZE O PREPARO.',
    text: 'Itens e observações chegam à produção sem precisar repetir o pedido.',
    features: ['Fila de preparo na tela em todos os planos', 'KDS e impressão automática no Pro e Premium', 'Status compartilhado pela equipe'],
  },
  {
    num: '03',
    slug: 'controlar',
    eyebrow: 'CONTROLAR',
    icon: ChartNoAxesCombined,
    title: 'SAIBA COMO SEU NEGÓCIO VAI.',
    text: 'Acompanhe vendas, custos e clientes para decidir com mais clareza.',
    features: ['Caixa e histórico em todos os planos', 'Estoque, relatórios e financeiro no Pro e Premium', 'Fidelidade e cupons no Premium'],
  },
];

export function Management() {
  return (
    <section className="koma-management-section" id="gestao" aria-labelledby="management-title">
      <div className="koma-section-heading koma-section-heading--light">
        <span>02 / O QUE VOCÊ RESOLVE</span>
        <h2 id="management-title">VENDER. OPERAR.<br />CONTROLAR.</h2>
        <p>Veja primeiro o que muda na rotina. Depois compare os planos sem misturar recursos.</p>
      </div>

      <div className="koma-management-grid">
        {GROUPS.map((group) => {
          const Icon = group.icon;

          return (
          <article className={`koma-management-card koma-management-card--${group.slug}`} key={group.num}>
            <div className="koma-management-card-top">
              <span>{group.num} / {group.eyebrow}</span>
              <i aria-hidden="true"><Icon size={20} strokeWidth={1.8} /></i>
            </div>
            <h3>{group.title}</h3>
            <p>{group.text}</p>
            <ul>
              {group.features.map((feature) => <li key={feature}>{feature}</li>)}
            </ul>
          </article>
          );
        })}
      </div>
    </section>
  );
}
