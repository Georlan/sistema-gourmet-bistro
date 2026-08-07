import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';

const STAGE_DATA = [
  {
    num: '01 / PEDIDO',
    title: 'LANÇADO EM SEGUNDOS.',
    desc: 'Garçom lança no tablet ou cliente pede no QR Code. Sem comanda de papel, sem erro de anotação.',
    word: 'PEDIDO',
    ui: {
      type: 'Order Slip',
      title: 'NOVO PEDIDO #0412',
      badge: 'SALÃO — MESA 04',
      items: [
        { name: '2x Cheese Bacon 120g', detail: 'Pão brioche, cheddar, bacon', price: 'R$ 50,00' },
        { name: '1x Suco de Laranja 500ml', detail: 'Sem açúcar, com gelo', price: 'R$ 12,00' },
      ],
      total: 'R$ 62,00',
    },
  },
  {
    num: '02 / SALÃO',
    title: 'SINCRONIA INSTANTÂNEA.',
    desc: 'O mapa de mesas atualiza na hora. Todo a equipe sabe o status de consumo de cada comanda.',
    word: 'SALÃO',
    ui: {
      type: 'Mesa Status',
      title: 'MESA 04 — OCUPADA',
      badge: 'GARÇOM: CARLOS',
      items: [
        { name: 'Pessoas na Mesa', detail: '3 Clientes', price: '38 min aberta' },
        { name: 'Último Lançamento', detail: 'Há 2 min (Bebidas)', price: '3 Itens' },
      ],
      total: 'R$ 184,50',
    },
  },
  {
    num: '03 / COZINHA',
    title: 'CHEGOU. SEM CHAMAR. SEM REPETIR.',
    desc: 'Pedido entra direto no KDS da cozinha com timer de preparo. Organização total na chapa e no bar.',
    word: 'COZINHA',
    ui: {
      type: 'KDS Ticket',
      title: 'TICKET #0412 — KDS COZINHA',
      badge: '⏱ 04:12 min — EM PREPARO',
      items: [
        { name: '2x Cheese Bacon 120g', detail: '🔴 OBS: 1x Sem Picles', price: 'Chapa 1' },
        { name: '1x Batata Rústica 300g', detail: 'Molho de alho à parte', price: 'Fritadeira' },
      ],
      total: 'PRIORIDADE: ALTA',
    },
  },
  {
    num: '04 / CAIXA',
    title: 'FECHAMENTO EM 3 CLIQUES.',
    desc: 'Divisão de conta, múltiplos meios de pagamento e emissão fiscal imediata no balcão.',
    word: 'CAIXA',
    ui: {
      type: 'Caixa Balcão',
      title: 'FECHAMENTO MESA 04',
      badge: 'CONTA SOLICITADA',
      items: [
        { name: 'Subtotal Consumo', detail: '10% Taxa de serviço inclusa', price: 'R$ 184,50' },
        { name: 'Forma de Pagamento', detail: 'PIX QrCode Dinâmico', price: 'APROVADO' },
      ],
      total: 'R$ 184,50 (PAGO)',
    },
  },
  {
    num: '05 / ENTREGA',
    title: 'DESPACHO AUTOMÁTICO.',
    desc: 'Integração com entrega e PWA do motoboy. Rastreio e notificação ao cliente em tempo real.',
    word: 'ENTREGA',
    ui: {
      type: 'Delivery Slip',
      title: 'PEDIDO DELIVERY #0490',
      badge: '🛵 EM ROTA — LUCAS',
      items: [
        { name: 'Endereço', detail: 'Av. Paulista, 1500 - Apto 42', price: '3.2 km' },
        { name: 'Previsão de Chegada', detail: '12 a 18 minutos', price: 'Em Andamento' },
      ],
      total: 'R$ 95,00',
    },
  },
];

export function OperationFlow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  // Calculate current stage index based on scroll
  const currentStageIndex = useTransform(scrollYProgress, (v) => {
    if (v < 0.2) return 0;
    if (v < 0.4) return 1;
    if (v < 0.6) return 2;
    if (v < 0.8) return 3;
    return 4;
  });

  const progressLineWidth = useTransform(scrollYProgress, [0.05, 0.95], ['0%', '100%']);

  // Dynamic Opacities for stages
  const op0 = useTransform(scrollYProgress, [0, 0.2], [1, 0.2]);
  const op1 = useTransform(scrollYProgress, [0.15, 0.35], [0.2, 1]);
  const op2 = useTransform(scrollYProgress, [0.35, 0.55], [0.2, 1]);
  const op3 = useTransform(scrollYProgress, [0.55, 0.75], [0.2, 1]);
  const op4 = useTransform(scrollYProgress, [0.75, 0.95], [0.2, 1]);

  return (
    <div ref={containerRef} className="koma-flow-section" id="solucoes">
      <div className="koma-flow-sticky">
        {/* Giant Dynamic Text Background (Transforming on scroll) */}
        <div className="koma-flow-giant-word">
          {STAGE_DATA[0].word}
        </div>

        {/* Section Headline */}
        <h2 className="koma-flow-main-headline">
          O PEDIDO ENTRA.<br />
          A OPERAÇÃO ACOMPANHA.
        </h2>

        {/* Dynamic Center Display (Editorial Copy + Real Stage UI) */}
        <div className="koma-flow-center">
          {STAGE_DATA.map((stage, i) => (
            <motion.div
              key={stage.num}
              style={{
                display: i === 0 ? 'flex' : 'flex',
                flexDirection: 'column',
                opacity: i === 0 ? op0 : i === 1 ? op1 : i === 2 ? op2 : i === 3 ? op3 : op4,
              }}
              className="koma-flow-editorial-block"
            >
              <span className="koma-flow-editorial-tag">{stage.num}</span>
              <h3 className="koma-flow-editorial-heading">{stage.title}</h3>
              <p className="koma-flow-editorial-body">{stage.desc}</p>
            </motion.div>
          )).slice(0, 1)} {/* Show active stage */}

          {/* Real Stage UI View */}
          <div className="koma-flow-ui-stage">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #222538', paddingBottom: '12px', marginBottom: '16px' }}>
              <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.9rem', fontWeight: 700, color: '#fff' }}>
                {STAGE_DATA[0].ui.title}
              </span>
              <span style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px', fontWeight: 600 }}>
                {STAGE_DATA[0].ui.badge}
              </span>
            </div>

            {STAGE_DATA[0].ui.items.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0', padding: '8px 0', borderBottom: '1px solid #1a1d2c' }}>
                <div>
                  <div style={{ fontFamily: 'Inter', fontSize: '0.85rem', fontWeight: 600, color: '#eee' }}>{item.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#888' }}>{item.detail}</div>
                </div>
                <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: '#00b894' }}>{item.price}</div>
              </div>
            ))}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px' }}>
              <span style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status do Sistema</span>
              <span style={{ fontFamily: 'Space Grotesk', fontSize: '1rem', fontWeight: 900, color: '#fff' }}>{STAGE_DATA[0].ui.total}</span>
            </div>
          </div>
        </div>

        {/* Timeline Progress Bar at bottom */}
        <div style={{ width: '100%' }}>
          <div className="koma-flow-timeline-bar">
            <motion.div className="koma-flow-timeline-progress" style={{ width: progressLineWidth }} />
          </div>
          <div className="koma-flow-timeline-stages">
            {STAGE_DATA.map((s, idx) => (
              <span
                key={s.num}
                className={`koma-flow-timeline-step ${idx === 0 ? 'koma-flow-timeline-step--active' : ''}`}
              >
                {s.word}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
