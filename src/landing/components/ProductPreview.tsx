import React from 'react';

export type ProductPreviewView = 'salon' | 'kitchen' | 'menu';

const TABLES = [
  { number: 1, state: 'free', label: 'Livre' },
  { number: 2, state: 'active', label: 'Em atendimento', total: 'R$ 48' },
  { number: 3, state: 'ready', label: 'Item pronto', total: 'R$ 72' },
  { number: 4, state: 'free', label: 'Livre' },
  { number: 5, state: 'active', label: 'Em atendimento', total: 'R$ 36' },
  { number: 6, state: 'free', label: 'Livre' },
  { number: 7, state: 'free', label: 'Livre' },
  { number: 8, state: 'active', label: 'Em atendimento', total: 'R$ 91' },
  { number: 9, state: 'free', label: 'Livre' },
  { number: 10, state: 'ready', label: 'Item pronto', total: 'R$ 29' },
  { number: 11, state: 'free', label: 'Livre' },
  { number: 12, state: 'free', label: 'Livre' },
] as const;

const KITCHEN_ORDERS = [
  { number: '#128', source: 'Mesa 02', time: '06 min', state: 'new', items: ['2× Smash bacon', '1× Batata rústica'], note: 'Sem cebola' },
  { number: '#127', source: 'Retirada', time: '11 min', state: 'making', items: ['1× Kôma clássico', '1× Refrigerante'], note: 'Retira no balcão' },
  { number: '#126', source: 'Mesa 10', time: '14 min', state: 'ready', items: ['2× Frango crocante', '1× Suco de laranja'], note: 'Pedido completo' },
] as const;

const MENU_PRODUCTS = [
  { name: 'Kôma Smash Bacon', description: 'Smash, cheddar, bacon crocante e molho da casa.', price: 'R$ 32,90', badge: 'Mais pedido' },
  { name: 'Kôma Clássico', description: 'Blend da casa, queijo, salada e maionese especial.', price: 'R$ 27,90' },
  { name: 'Batata Rústica', description: 'Porção com alecrim e molho da casa.', price: 'R$ 18,90' },
] as const;

function PreviewHeader({ label, status }: { label: string; status: string }) {
  return (
    <header className="koma-preview-header">
      <div className="koma-preview-brand">
        <span className="koma-preview-mark" aria-hidden="true">K</span>
        <div>
          <strong>KÔMA BISTRÔ</strong>
          <small>{label}</small>
        </div>
      </div>
      <span className="koma-preview-status"><i aria-hidden="true" />{status}</span>
    </header>
  );
}

function SalonPreview() {
  return (
    <div className="koma-preview-view">
      <PreviewHeader label="Salão e comandas" status="Sincronizado" />
      <div className="koma-preview-toolbar">
        <div>
          <strong>Visão do salão</strong>
          <small>Toque em uma mesa para abrir a comanda.</small>
        </div>
        <div className="koma-preview-metrics" aria-label="Resumo do salão">
          <span><b>8</b> livres</span>
          <span><b>3</b> ocupadas</span>
          <span><b>2</b> prontas</span>
        </div>
      </div>
      <div className="koma-preview-table-grid">
        {TABLES.map((table) => (
          <article className={`koma-preview-table is-${table.state}`} key={table.number}>
            <span>MESA</span>
            <strong>{String(table.number).padStart(2, '0')}</strong>
            <small>{table.label}</small>
            {'total' in table && <b>{table.total}</b>}
          </article>
        ))}
      </div>
    </div>
  );
}

function KitchenPreview() {
  return (
    <div className="koma-preview-view">
      <PreviewHeader label="Cozinha e produção" status="3 pedidos ativos" />
      <div className="koma-preview-toolbar">
        <div>
          <strong>Fila da cozinha</strong>
          <small>Itens, observações e tempo no mesmo lugar.</small>
        </div>
        <div className="koma-preview-filter"><span>Todos</span><span>Em preparo</span><span>Prontos</span></div>
      </div>
      <div className="koma-preview-kitchen-grid">
        {KITCHEN_ORDERS.map((order) => (
          <article className={`koma-preview-order is-${order.state}`} key={order.number}>
            <header><span>{order.source}</span><b>{order.time}</b></header>
            <strong>{order.number}</strong>
            <ul>{order.items.map((item) => <li key={item}>{item}</li>)}</ul>
            <small>{order.note}</small>
            <button type="button" tabIndex={-1}>{order.state === 'ready' ? 'Pronto para entregar' : 'Avançar pedido'}</button>
          </article>
        ))}
      </div>
    </div>
  );
}

function MenuPreview() {
  return (
    <div className="koma-preview-view koma-preview-view--menu">
      <PreviewHeader label="Cardápio online" status="Recebendo pedidos" />
      <div className="koma-preview-menu-layout">
        <aside>
          <span>Seu cardápio</span>
          <strong>Escolha o seu pedido</strong>
          <p>Produtos e disponibilidade ligados ao mesmo cadastro do caixa.</p>
          <div><b>Destacados</b><b className="is-active">Hambúrgueres</b><b>Porções</b><b>Bebidas</b></div>
        </aside>
        <div className="koma-preview-products">
          {MENU_PRODUCTS.map((product) => (
            <article key={product.name}>
              <div className="koma-preview-product-image" aria-hidden="true"><span /></div>
              <div>
                {'badge' in product && <small>{product.badge}</small>}
                <strong>{product.name}</strong>
                <p>{product.description}</p>
                <b>{product.price}</b>
              </div>
              <button type="button" tabIndex={-1}>+</button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ProductPreview({ view = 'salon', className = '' }: { view?: ProductPreviewView; className?: string }) {
  return (
    <div className={`koma-product-preview ${className}`} aria-label="Prévia da interface do Kôma">
      <div className="koma-product-browser-bar" aria-hidden="true">
        <span /><span /><span />
        <i>app.koma.com.br</i>
      </div>
      {view === 'salon' && <SalonPreview />}
      {view === 'kitchen' && <KitchenPreview />}
      {view === 'menu' && <MenuPreview />}
    </div>
  );
}
