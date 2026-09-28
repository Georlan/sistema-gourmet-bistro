import React, { useEffect, useRef, useState } from 'react';

const screens = [
  { id: 'pedidos', label: 'Pedidos', title: 'Pedidos por etapa.', body: 'Mesas em atendimento, pedidos digitais e itens prontos aparecem por etapa, com status, valores e ações no pedido.', note: 'Pedidos e fila de preparo na tela em todos os planos.', image: '/landing-v2/pedidos.webp', width: 1610, height: 440, device: 'laptop' },
  { id: 'cozinha', label: 'Cozinha', title: 'Produção da cozinha.', body: 'Tickets e itens ficam organizados entre “Em produção” e “Prontos para sair”, com ações de pronto e entregue.', note: 'KDS dedicado e impressão automática no Pro e Premium.', image: '/landing-v2/cozinha.webp', width: 1610, height: 670, device: 'tablet' },
  { id: 'cardapio', label: 'Cardápio', title: 'Cardápio no celular.', body: 'O cliente encontra produtos, escolhe entrega ou retirada e envia o pedido pelo Cardápio Online.', note: 'Cardápio Online incluído em todos os planos.', image: '/landing-v2/cardapio.webp', width: 395, height: 856, device: 'phone' },
] as const;

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const sync = () => { const index = screens.findIndex(screen => window.location.hash === `#${screen.id}`); if (index >= 0) setActive(index); };
    sync(); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync);
  }, []);
  const select = (index: number) => { setActive(index); window.history.replaceState(null, '', `#${screens[index].id}`); };
  const screen = screens[active];
  return <section className="v2-section v2-product" id="como-funciona" aria-labelledby="product-title">
    <div className="v2-wrap">
      <div className="v2-section-heading" data-reveal><p className="v2-eyebrow">Produto real</p><h2 id="product-title">Veja a operação nas telas.</h2><p>Prévia do produto com dados de demonstração.</p></div>
      <div className="v2-tabs" role="tablist" aria-label="Telas do produto">{screens.map((item, index) => <button key={item.id} ref={el => { tabs.current[index] = el; }} type="button" role="tab" id={`tab-${item.id}`} aria-controls="product-panel" aria-selected={index === active} tabIndex={index === active ? 0 : -1} onClick={() => select(index)} onKeyDown={event => {
        const next = event.key === 'ArrowRight' ? (index + 1) % screens.length : event.key === 'ArrowLeft' ? (index + screens.length - 1) % screens.length : event.key === 'Home' ? 0 : event.key === 'End' ? screens.length - 1 : -1;
        if (next < 0) return; event.preventDefault(); select(next); tabs.current[next]?.focus();
      }}>{item.label}</button>)}</div>
      <div key={screen.id} className="v2-product-panel" role="tabpanel" id="product-panel" aria-labelledby={`tab-${screen.id}`} tabIndex={0}>
        <div className="v2-product-copy"><h3>{screen.title}</h3><p>{screen.body}</p><p className="v2-product-note">{screen.note}</p><a className="v2-text-link" href="#planos">Comparar planos <span aria-hidden="true">↗</span></a></div>
        <div className={`v2-device v2-device--${screen.device}`}><div className="v2-device-screen"><img src={screen.image} alt={`Tela real de ${screen.title}`} width={screen.width} height={screen.height} loading="lazy" decoding="async" /></div></div>
      </div>
    </div>
  </section>;
}
