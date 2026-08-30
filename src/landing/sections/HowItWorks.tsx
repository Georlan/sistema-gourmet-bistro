import React, { useEffect, useRef, useState } from 'react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { EditablePhoneFrame, type PhoneScreenshot } from '../product/EditablePhoneFrame';
import { ProductScreen } from '../product/ProductScreen';
import { TabletFrame } from '../product/TabletFrame';
import type { DeviceScreenshot } from '../product/DeviceScreenshot';
import phoneShell from '../../assets/koma-phone-graphite-shell-v2.png';
import '../product/editable-phone.css';

export const PRODUCT_TOUR = [
  {
    id: 'pedidos', num: '01', label: 'Pedidos',
    title: 'CADA PEDIDO NO SEU LUGAR.',
    description: 'Veja o que entrou, o que está em preparo e o que já pode sair. Mesas e delivery na mesma operação.',
    note: 'Pedidos e fila de preparo em todos os planos.',
    device: 'laptop', view: 'pdv',
  },
  {
    id: 'salao', num: '02', label: 'Cozinha',
    title: 'MENOS PERGUNTAS. MAIS AGILIDADE.',
    description: 'A cozinha recebe itens, quantidades e observações na tela. Sem repetir o pedido no balcão.',
    note: 'Painel de cozinha (KDS) e impressão automática no Pro e Premium.',
    device: 'tablet', view: 'kds',
  },
  {
    id: 'cardapio', num: '03', label: 'Cardápio',
    title: 'SEU CLIENTE PEDE PELO CELULAR.',
    description: 'Compartilhe o link ou o QR Code. O pedido chega ao Kôma, sem você precisar digitar tudo de novo.',
    note: 'Cardápio digital incluído em todos os planos.',
    device: 'phone', view: 'cardapio',
  },
] as const;

export function HowItWorks({ cardapioScreenshot, cozinhaScreenshot }: {
  cardapioScreenshot?: PhoneScreenshot;
  cozinhaScreenshot?: DeviceScreenshot;
} = {}) {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const section = useRef<HTMLElement>(null);

  useEffect(() => {
    const followHash = () => {
      const index = PRODUCT_TOUR.findIndex(screen => `#${screen.id}` === window.location.hash);
      if (index < 0) return;
      setActive(index);
      requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'start' }));
    };
    followHash();
    window.addEventListener('hashchange', followHash);
    return () => window.removeEventListener('hashchange', followHash);
  }, []);

  const select = (index: number) => {
    setActive(index);
    window.history.replaceState(null, '', `#${PRODUCT_TOUR[index].id}`);
  };

  return (
    <section ref={section} className="koma-flow-section koma-scroll-flow koma-compact-tour" id="como-funciona" aria-labelledby="how-title">
      <div className="koma-section-heading koma-section-heading--dark">
        <span>03 / VEJA O PRODUTO</span>
        <h2 id="how-title">UM TOUR.<br />TRÊS TELAS.</h2>
        <p>Escolha uma tela para conhecer o fluxo. Prévia com dados de demonstração.</p>
      </div>
      <div className="koma-tour-tabs" role="tablist" aria-label="Telas do produto">
        {PRODUCT_TOUR.map((screen, index) => (
          <button key={screen.id} ref={element => { tabs.current[index] = element; }} type="button" role="tab"
            id={`tab-${screen.id}`} aria-controls={screen.id} aria-selected={active === index} tabIndex={active === index ? 0 : -1}
            onClick={() => select(index)} onKeyDown={event => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % PRODUCT_TOUR.length;
              else if (event.key === 'ArrowLeft') next = (index + PRODUCT_TOUR.length - 1) % PRODUCT_TOUR.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = PRODUCT_TOUR.length - 1;
              else return;
              event.preventDefault();
              select(next);
              tabs.current[next]?.focus();
            }}>
            <span>{screen.num}</span>{screen.label}
          </button>
        ))}
      </div>
      {PRODUCT_TOUR.map((screen, index) => (
        <div key={screen.id} id={screen.id} role="tabpanel" aria-labelledby={`tab-${screen.id}`} tabIndex={0}
          hidden={active !== index} className={`koma-tour-panel koma-tour-panel--${screen.device}`}>
          <div className="koma-tour-copy">
            <h3>{screen.title}</h3>
            <p>{screen.description}</p>
            <small>{screen.note}</small>
            <a href="#planos" className="koma-tour-plans-link">Compare os planos →</a>
          </div>
          <figure className="koma-tour-device">
            {active === index && (screen.device === 'phone' ? (
              <EditablePhoneFrame shellSrc={phoneShell} screenshot={cardapioScreenshot}>
                <ProductScreen view="cardapio" scaleLogicalWidth={430} />
              </EditablePhoneFrame>
            ) : screen.device === 'tablet' ? (
              <TabletFrame view={screen.view} screenshot={cozinhaScreenshot} />
            ) : <FrontalLaptopFrame device={screen.device} view={screen.view} />)}
            <figcaption>Prévia ilustrativa do Kôma · {screen.label}</figcaption>
          </figure>
        </div>
      ))}
    </section>
  );
}
