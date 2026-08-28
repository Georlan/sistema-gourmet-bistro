import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { PhoneFrame } from '../product/PhoneFrame';

const CUSTOMER_POINTS = [
  ['01', 'QR CODE NA MESA', 'O cliente abre o cardápio no próprio celular.'],
  ['02', 'ESCOLHA SEM PRESSA', 'Itens, adicionais e observações ficam claros.'],
  ['03', 'PEDIDO NO MESMO FLUXO', 'A solicitação entra na operação para aceite e produção.'],
];

export function CardapioScene() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.15 });

  return (
    <section ref={ref} className="koma-cardapio-section" id="cardapio-digital" aria-labelledby="cardapio-title">
      <motion.div
        className="koma-cardapio-copy"
        initial={{ opacity: 0, y: 24 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7 }}
      >
        <span className="koma-section-kicker">04 / EXPERIÊNCIA DO CLIENTE</span>
        <h2 id="cardapio-title">O CARDÁPIO<br />TAMBÉM OPERA.</h2>
        <p className="koma-cardapio-lead">
          Uma experiência móvel com a identidade do restaurante, conectada ao mesmo fluxo do salão e da cozinha.
        </p>

        <div className="koma-cardapio-points">
          {CUSTOMER_POINTS.map(([num, title, text]) => (
            <div key={num}>
              <span>{num}</span>
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.div
        className="koma-cardapio-device"
        initial={{ opacity: 0, y: 36, rotate: 2 }}
        animate={isInView ? { opacity: 1, y: 0, rotate: -2 } : {}}
        transition={{ duration: 0.85, delay: 0.12 }}
      >
        <div className="koma-cardapio-orbit" aria-hidden="true">CARDÁPIO / QR CODE / PEDIDO</div>
        <PhoneFrame />
      </motion.div>
    </section>
  );
}
