import React from 'react';
import { motion } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

const PILLARS = [
  {
    id: 'caixa',
    num: '01',
    label: 'CAIXA',
    title: 'VENDA E FECHAMENTO NO MESMO LUGAR.',
    description: 'Registre pedidos, acompanhe comandas e feche o turno com o histórico da operação. Pagamentos parciais e o saldo da mesa permanecem visíveis até o fechamento.',
    points: ['PDV E COMANDAS', 'PAGAMENTO PARCIAL', 'FECHAMENTO DE TURNO'],
    outcome: 'MENOS CONTA REFEITA. MAIS CONTROLE NO CAIXA.',
    device: 'laptop',
  },
  {
    id: 'salao',
    num: '02',
    label: 'SALÃO E PRODUÇÃO',
    title: 'O PEDIDO SAI DA MESA E CHEGA CLARO À COZINHA.',
    description: 'O garçom lança uma vez. Mesas, produção e impressão recebem itens, quantidades e observações sem um novo repasse manual.',
    points: ['MESAS AO VIVO', 'KDS E IMPRESSÃO', 'STATUS DO PEDIDO'],
    outcome: 'A EQUIPE ACOMPANHA. A COZINHA PRODUZ.',
    device: 'tablet',
  },
  {
    id: 'cardapio',
    num: '03',
    label: 'CARDÁPIO',
    title: 'O CLIENTE PEDE PELO PRÓPRIO CELULAR.',
    description: 'O QR Code abre um cardápio conectado à mesma base do caixa. Preço, disponibilidade, adicionais e observações seguem para o pedido sem cadastro repetido.',
    points: ['QR CODE', 'CARDÁPIO CENTRALIZADO', 'PEDIDO CONECTADO'],
    outcome: 'MUDE UMA VEZ. ATUALIZE A OPERAÇÃO.',
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
  return (
    <section className="koma-flow-section koma-scroll-flow" id="como-funciona" aria-labelledby="how-title">
      <div className="koma-section-heading koma-section-heading--dark">
        <span>03 / COMO FUNCIONA</span>
        <h2 id="how-title">TRÊS PONTOS.<br />UM SÓ FLUXO.</h2>
        <p>Do pedido ao fechamento, cada tela recebe a mesma informação sem um novo repasse manual.</p>
      </div>

      <div className="koma-scroll-modules">
        {PILLARS.map((pillar, index) => (
          <motion.article
            key={pillar.id}
            id={pillar.id}
            className={`koma-scroll-module koma-scroll-module--${pillar.device}`}
            initial={{ opacity: 0.42, y: 34 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.32 }}
            transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className="koma-scroll-module-copy"
              initial={{ opacity: 0, x: index % 2 === 0 ? -24 : 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.45 }}
              transition={{ duration: 0.55, delay: 0.08 }}
            >
              <span>{pillar.num} / {pillar.label}</span>
              <h3>{pillar.title}</h3>
              <p>{pillar.description}</p>
              <ul>
                {pillar.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
              <strong className="koma-scroll-module-outcome">{pillar.outcome}</strong>
            </motion.div>

            <motion.div
              className="koma-scroll-module-device"
              initial={{ opacity: 0, y: 28, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.28 }}
              transition={{ duration: 0.68, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              <PillarDevice pillar={pillar} />
            </motion.div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
