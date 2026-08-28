import React from 'react';
import { motion } from 'motion/react';
import { FrontalLaptopFrame } from '../product/FrontalLaptopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

const PRODUCT_TOUR = [
  {
    id: 'pedidos',
    num: '01',
    label: 'PEDIDOS',
    short: 'Atendimento e status',
    title: 'VEJA CADA PEDIDO AVANÇAR.',
    description: 'Mesas, balcão e delivery aparecem organizados por etapa. A equipe sabe o que entrou, o que está em preparo e o que já pode ser concluído.',
    points: ['SALÃO, BALCÃO E DELIVERY', 'ETAPAS E STATUS', 'HISTÓRICO DO PEDIDO'],
    outcome: 'PRIORIDADE VISÍVEL. PRÓXIMA AÇÃO CLARA.',
    device: 'laptop',
    view: 'pdv',
  },
  {
    id: 'salao',
    num: '02',
    label: 'COZINHA',
    short: 'Produção e prioridade',
    title: 'A PRODUÇÃO RECEBE O QUE PRECISA.',
    description: 'Itens, quantidades, observações e tempo chegam à cozinha no mesmo pedido lançado pelo atendimento.',
    points: ['FILA DE PRODUÇÃO', 'TEMPO E OBSERVAÇÕES', 'KDS E IMPRESSÃO'],
    outcome: 'MENOS PERGUNTA NO BALCÃO. MAIS FOCO NA PRODUÇÃO.',
    device: 'tablet',
    view: 'kds',
  },
  {
    id: 'cardapio',
    num: '03',
    label: 'CARDÁPIO',
    short: 'Pedido no celular',
    title: 'O CLIENTE PEDE PELO PRÓPRIO CELULAR.',
    description: 'O QR Code abre um cardápio conectado à mesma base do caixa. Preço, disponibilidade, adicionais e observações seguem para o pedido sem cadastro repetido.',
    points: ['QR CODE', 'CARDÁPIO CENTRALIZADO', 'PEDIDO CONECTADO'],
    outcome: 'O CLIENTE PEDE. A OPERAÇÃO CONTINUA NO MESMO FLUXO.',
    device: 'phone',
    view: 'cardapio',
  },
] as const;

type TourScreen = (typeof PRODUCT_TOUR)[number];

function TourDevice({ screen }: { screen: TourScreen }) {
  if (screen.device === 'phone') return <PhoneFrame />;
  if (screen.device === 'tablet') return <TabletFrame view={screen.view} />;
  return <FrontalLaptopFrame view={screen.view} />;
}

export function HowItWorks() {
  return (
    <section className="koma-flow-section koma-scroll-flow" id="como-funciona" aria-labelledby="how-title">
      <div className="koma-section-heading koma-section-heading--dark">
        <span>04 / TOUR DO PRODUTO</span>
        <h2 id="how-title">UM TOUR.<br />TRÊS TELAS.</h2>
        <p>Veja como o mesmo pedido aparece para quem atende, produz e compra.</p>
      </div>

      <nav className="koma-tour-rail" aria-label="Etapas do tour do produto">
        {PRODUCT_TOUR.map((screen) => (
          <a href={`#${screen.id}`} key={screen.id}>
            <span>{screen.num}</span>
            <strong>{screen.label}</strong>
            <small>{screen.short}</small>
          </a>
        ))}
      </nav>

      <div className="koma-scroll-modules">
        {PRODUCT_TOUR.map((screen, index) => (
          <motion.article
            key={screen.id}
            id={screen.id}
            className={`koma-scroll-module koma-scroll-module--${screen.device}`}
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
              <span>{screen.num} / {screen.label}</span>
              <h3>{screen.title}</h3>
              <p>{screen.description}</p>
              <ul>
                {screen.points.map((point) => <li key={point}>{point}</li>)}
              </ul>
              <strong className="koma-scroll-module-outcome">{screen.outcome}</strong>
            </motion.div>

            <motion.div
              className="koma-scroll-module-device"
              initial={{ opacity: 0, y: 28, scale: 0.97 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true, amount: 0.28 }}
              transition={{ duration: 0.68, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            >
              <TourDevice screen={screen} />
            </motion.div>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
