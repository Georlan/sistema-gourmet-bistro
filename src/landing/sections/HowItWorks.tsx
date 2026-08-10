import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

const PILLARS = [
  {
    id: 'caixa',
    num: '01',
    label: 'CAIXA',
    title: 'VENDA E FECHAMENTO NO MESMO LUGAR.',
    description: 'Registre pedidos, acompanhe comandas, receba pagamentos e feche o turno com o histórico da operação.',
    points: ['PDV E COMANDAS', 'PAGAMENTOS', 'FECHAMENTO DE TURNO'],
    device: 'laptop',
  },
  {
    id: 'salao',
    num: '02',
    label: 'SALÃO',
    title: 'A EQUIPE SABE QUAL MESA PRECISA DELA.',
    description: 'O garçom lança o pedido e acompanha status, consumo e atendimento sem voltar ao caixa para conferir.',
    points: ['MESAS AO VIVO', 'APP DO GARÇOM', 'STATUS DO PEDIDO'],
    device: 'tablet',
  },
  {
    id: 'cardapio',
    num: '03',
    label: 'CARDÁPIO',
    title: 'O CLIENTE PEDE PELO PRÓPRIO CELULAR.',
    description: 'O QR Code abre um cardápio conectado ao cadastro e ao fluxo de pedidos do restaurante.',
    points: ['QR CODE', 'ADICIONAIS E OBSERVAÇÕES', 'PEDIDO CONECTADO'],
    device: 'phone',
  },
] as const;

type Pillar = (typeof PILLARS)[number];

function PillarDevice({ pillar }: { pillar: Pillar }) {
  if (pillar.device === 'phone') return <PhoneFrame />;
  if (pillar.device === 'tablet') return <TabletFrame view="mesas" />;
  return <FrontalLaptopFrame view="mesas" />;
}

export function HowItWorks() {
  const [activeId, setActiveId] = useState<Pillar['id']>('caixa');
  const activePillar = PILLARS.find((pillar) => pillar.id === activeId) ?? PILLARS[0];

  return (
    <section className="koma-flow-section koma-how-section" id="como-funciona" aria-labelledby="how-title">
      <div className="koma-section-heading koma-section-heading--dark">
        <span>03 / COMO FUNCIONA</span>
        <h2 id="how-title">TRÊS PONTOS.<br />UM SÓ FLUXO.</h2>
        <p>Caixa, salão e cardápio compartilham a mesma operação. Escolha um pilar para ver como cada tela participa.</p>
      </div>

      <div className="koma-flow-layout">
        <div className="koma-flow-tabs koma-how-tabs" role="tablist" aria-label="Pilares do Kôma">
          {PILLARS.map((pillar) => (
            <button
              key={pillar.id}
              type="button"
              role="tab"
              aria-selected={pillar.id === activePillar.id}
              className={`koma-flow-tab ${pillar.id === activePillar.id ? 'koma-flow-tab--active' : ''}`}
              onClick={() => setActiveId(pillar.id)}
            >
              <span>{pillar.num}</span>
              <strong>{pillar.label}</strong>
            </button>
          ))}
        </div>

        <div className="koma-flow-content koma-how-content">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${activePillar.id}-copy`}
              className="koma-flow-copy"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <span>{activePillar.num} / {activePillar.label}</span>
              <h3>{activePillar.title}</h3>
              <p>{activePillar.description}</p>
              <ul className="koma-how-points">
                {activePillar.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${activePillar.id}-device`}
              className={`koma-how-device koma-how-device--${activePillar.device}`}
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.985 }}
              transition={{ duration: 0.38 }}
            >
              <PillarDevice pillar={activePillar} />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}
