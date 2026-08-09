import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';

export function OrderTransition() {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start end', 'end start'],
  });

  const ticketX = useTransform(scrollYProgress, [0.12, 0.82], ['0vw', '43vw']);
  const ticketY = useTransform(scrollYProgress, [0.12, 0.82], [0, 176]);
  const ticketRotate = useTransform(scrollYProgress, [0.12, 0.82], [-2, 3]);
  const manualOpacity = useTransform(scrollYProgress, [0.12, 0.48], [1, 0.16]);
  const connectedOpacity = useTransform(scrollYProgress, [0.42, 0.72], [0.18, 1]);
  const connectedY = useTransform(scrollYProgress, [0.42, 0.72], [18, 0]);

  return (
    <section ref={sectionRef} className="koma-order-transition" aria-label="Quatro intervenções manuais se tornam um registro conectado">
      <div className="koma-order-transition-dark" aria-hidden="true" />
      <div className="koma-order-transition-line" aria-hidden="true" />

      <div className="koma-order-transition-inner">
        <motion.div className="koma-order-manual" style={{ opacity: manualOpacity }}>
          <small>ANTES</small>
          <strong>4 INTERVENÇÕES</strong>
          <span>anotar</span><span>repassar</span><span>conferir</span><span>somar</span>
        </motion.div>

        <motion.div
          className="koma-order-ticket"
          style={{ x: ticketX, y: ticketY, rotate: ticketRotate }}
          aria-hidden="true"
        >
          <span>PEDIDO</span>
          <strong>#0412</strong>
          <i />
        </motion.div>

        <motion.div
          className="koma-order-connected"
          style={{ opacity: connectedOpacity, y: connectedY }}
        >
          <small>COM KÔMA</small>
          <strong>1 REGISTRO CONECTADO</strong>
          <p>O pedido segue do atendimento ao caixa sem precisar ser reconstruído.</p>
        </motion.div>

        <div className="koma-order-transition-caption">
          <span>4</span>
          <i aria-hidden="true" />
          <span>1</span>
          <strong>A MESMA INFORMAÇÃO. MENOS CAMINHO.</strong>
        </div>
      </div>
    </section>
  );
}
