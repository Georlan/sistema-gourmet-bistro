import React, { useState } from 'react';
import { ProductPreview, type ProductPreviewView } from '../components/ProductPreview';

const VIEWS: Array<{
  id: ProductPreviewView;
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
}> = [
  {
    id: 'salon',
    label: 'Salão e caixa',
    eyebrow: 'Do atendimento ao pagamento',
    title: 'Mesas, comandas e totais sempre visíveis.',
    description: 'O garçom registra, o caixa acompanha e a gestão enxerga o movimento do salão sem conferir papel ou perguntar o status.',
    points: ['Mesas atualizadas em tempo real', 'Comandas ligadas ao pedido', 'Fechamento com histórico'],
  },
  {
    id: 'kitchen',
    label: 'Cozinha',
    eyebrow: 'Da venda à produção',
    title: 'A cozinha recebe o pedido claro e organizado.',
    description: 'Itens, quantidades, observações e tempo de espera chegam juntos. A equipe avança o status e o salão acompanha.',
    points: ['Fila de produção organizada', 'Observações no pedido certo', 'KDS e impressão automática'],
  },
  {
    id: 'menu',
    label: 'Cardápio digital',
    eyebrow: 'Do celular para a operação',
    title: 'O cliente pede pelo celular. O caixa recebe no fluxo.',
    description: 'Preço, disponibilidade e adicionais usam o mesmo cadastro do sistema. O pedido digital chega pronto para aceite no PDV.',
    points: ['QR Code por mesa ou balcão', 'Cardápio centralizado', 'Pedido digital integrado'],
  },
];

const BENEFITS = [
  { number: '01', title: 'Menos retrabalho', text: 'A informação não precisa ser copiada entre salão, cozinha e caixa.' },
  { number: '02', title: 'Mais clareza na produção', text: 'Cada pedido leva itens, observações e status para quem precisa agir.' },
  { number: '03', title: 'Fechamento sob controle', text: 'Consumo, pagamentos e histórico permanecem ligados à comanda.' },
  { number: '04', title: 'Venda também no celular', text: 'O cardápio digital transforma o pedido do cliente em operação real.' },
];

const IMPLEMENTATION_STEPS = [
  { number: '1', title: 'Entendemos sua rotina', text: 'Mapeamos salão, balcão, delivery, equipamentos e fluxo de impressão.' },
  { number: '2', title: 'Configuramos o Kôma', text: 'Organizamos cardápio, usuários, permissões e etapas da operação.' },
  { number: '3', title: 'Colocamos a equipe para operar', text: 'A implantação é acompanhada e o treinamento acontece com o fluxo real.' },
];

export function HowItWorks() {
  const [activeView, setActiveView] = useState<ProductPreviewView>('salon');
  const activeContent = VIEWS.find((view) => view.id === activeView) ?? VIEWS[0];

  return (
    <>
      <section className="koma-product-section" id="produto" aria-labelledby="product-title">
        <div className="koma-container">
          <header className="koma-section-intro">
            <p className="koma-eyebrow koma-eyebrow--dark"><span />O produto por dentro</p>
            <div>
              <h2 id="product-title">A operação anda.<br /><em>Sua equipe acompanha.</em></h2>
              <p>Explore as telas que conectam atendimento, produção e venda digital.</p>
            </div>
          </header>

          <div className="koma-product-tabs" role="tablist" aria-label="Áreas do Kôma">
            {VIEWS.map((view) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeView === view.id}
                className={activeView === view.id ? 'is-active' : ''}
                onClick={() => setActiveView(view.id)}
                key={view.id}
              >
                {view.label}
              </button>
            ))}
          </div>

          <div className="koma-product-stage">
            <div className="koma-product-copy" role="tabpanel">
              <span>{activeContent.eyebrow}</span>
              <h3>{activeContent.title}</h3>
              <p>{activeContent.description}</p>
              <ul>{activeContent.points.map((point) => <li key={point}><i aria-hidden="true">✓</i>{point}</li>)}</ul>
            </div>
            <ProductPreview view={activeView} />
          </div>
        </div>
      </section>

      <section className="koma-benefits-section" aria-labelledby="benefits-title">
        <div className="koma-container">
          <header className="koma-benefits-heading">
            <p className="koma-eyebrow"><span />Por que o Kôma funciona</p>
            <h2 id="benefits-title">Menos ruído na equipe.<br /><em>Mais controle para o dono.</em></h2>
          </header>
          <div className="koma-benefit-grid">
            {BENEFITS.map((benefit) => (
              <article key={benefit.number}>
                <span>{benefit.number}</span>
                <h3>{benefit.title}</h3>
                <p>{benefit.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="koma-implementation-section" id="implantacao" aria-labelledby="implementation-title">
        <div className="koma-container koma-implementation-layout">
          <div className="koma-implementation-copy">
            <p className="koma-eyebrow koma-eyebrow--dark"><span />Implantação acompanhada</p>
            <h2 id="implementation-title">Começar não precisa parar o restaurante.</h2>
            <p>Antes de qualquer contratação, confirmamos se o Kôma encaixa na sua estrutura e planejamos a entrada por etapas.</p>
          </div>
          <div className="koma-implementation-steps">
            {IMPLEMENTATION_STEPS.map((step) => (
              <article key={step.number}>
                <span>{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.text}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
