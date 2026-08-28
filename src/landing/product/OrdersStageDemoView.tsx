import React from 'react';
import { CheckCircle2, Clock3, Store, Truck } from 'lucide-react';

const lanes = [
  {
    key: 'salao',
    number: '01',
    title: 'Mesas em atendimento',
    subtitle: 'Pedidos lançados no salão',
    icon: Store,
    count: 2,
    cards: [
      {
        title: 'Mesa 01',
        meta: 'Pedido #22 · 1 item',
        value: 'R$ 48,00',
        status: 'EM ATENDIMENTO',
        items: 'Pizza Margherita Especial',
        tone: 'active',
      },
      {
        title: 'Mesa 02',
        meta: 'Pedido #23 · 4 itens',
        value: 'R$ 209,00',
        status: 'EM ATENDIMENTO',
        items: 'Pizzas, adicionais e bebidas',
        tone: 'active',
      },
    ],
  },
  {
    key: 'retirada',
    number: '02',
    title: 'Balcão e delivery',
    subtitle: 'Retirada e entrega organizadas',
    icon: Truck,
    count: 1,
    cards: [
      {
        title: 'Pedido #21',
        meta: 'Retirada · há 3 min',
        value: 'R$ 48,00',
        status: 'EM PREPARO',
        items: 'Pizza Margherita Especial',
        tone: 'preparing',
      },
    ],
  },
  {
    key: 'fechamento',
    number: '03',
    title: 'Prontos e conclusão',
    subtitle: 'O que já pode ser finalizado',
    icon: CheckCircle2,
    count: 1,
    cards: [
      {
        title: 'Mesa 07',
        meta: 'Pedido #19 · 3 itens',
        value: 'R$ 86,00',
        status: 'PRONTO',
        items: 'Aguardando recebimento',
        tone: 'ready',
      },
    ],
  },
] as const;

export function OrdersStageDemoView() {
  return (
    <section className="koma-orders-demo" aria-label="Pedidos organizados por etapa">
      <header className="koma-orders-demo-header">
        <div>
          <span className="koma-orders-demo-eyebrow"><i /> OPERAÇÃO AO VIVO</span>
          <h2>Pedidos <strong>por etapa</strong></h2>
          <p>Salão, retirada e fechamento visíveis em um único fluxo.</p>
        </div>

        <div className="koma-orders-demo-metrics" aria-label="Resumo da operação">
          <div><strong>4 min</strong><span>pedido mais antigo</span></div>
          <div><strong>R$ 305</strong><span>valor em aberto</span></div>
          <div><strong>4</strong><span>pedidos ativos</span></div>
        </div>
      </header>

      <div className="koma-orders-demo-signal">
        <Clock3 aria-hidden="true" />
        <span>Informação atualizada em tempo real</span>
        <strong><i /> TUDO SINCRONIZADO</strong>
      </div>

      <div className="koma-orders-demo-board">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          return (
            <article key={lane.key} className={`koma-orders-demo-lane koma-orders-demo-lane--${lane.key}`}>
              <header>
                <span>{lane.number}</span>
                <Icon aria-hidden="true" />
                <div>
                  <h3>{lane.title}</h3>
                  <p>{lane.subtitle}</p>
                </div>
                <strong>{lane.count}</strong>
              </header>

              <div className="koma-orders-demo-cards">
                {lane.cards.map((card) => (
                  <div key={card.title} className={`koma-orders-demo-card koma-orders-demo-card--${card.tone}`}>
                    <div className="koma-orders-demo-card-top">
                      <div>
                        <h4>{card.title}</h4>
                        <span>{card.meta}</span>
                      </div>
                      <strong>{card.value}</strong>
                    </div>
                    <p>{card.items}</p>
                    <div className="koma-orders-demo-card-status">
                      <i />
                      <span>{card.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
