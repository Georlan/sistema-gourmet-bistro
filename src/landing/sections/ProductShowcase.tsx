import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { DesktopFrame } from '../product/DesktopFrame';

export function ProductShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.15 });

  return (
    <section
      ref={sectionRef}
      className="koma-section-white"
      id="produto"
      aria-label="Produto"
    >
      <div className="koma-showcase-header">
        <motion.h2
          className="koma-showcase-title"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          DO SALÃO<br />À COZINHA.
        </motion.h2>

        <motion.div
          className="koma-showcase-editorial"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="koma-showcase-item">
            <span className="koma-showcase-item-num">01 / MESAS</span>
            <p className="koma-showcase-item-desc">
              Visão da operação em tempo real. Cada mesa atualizada a cada pedido lançado.
            </p>
          </div>
          <div className="koma-showcase-item">
            <span className="koma-showcase-item-num">02 / PEDIDOS</span>
            <p className="koma-showcase-item-desc">
              Lançado no garçom ou QR Code. A cozinha e o caixa acompanham no mesmo fluxo.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Boldium-style Physical Laptop Frame Component with Real KÔMA App (Occupying 70-75% Width) */}
      <motion.div
        className="koma-showcase-display"
        initial={{ opacity: 0, y: 50, scale: 0.98 }}
        animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
        transition={{ duration: 1, delay: 0.3 }}
      >
        <div className="koma-annotation" style={{ top: '-24px', left: '10%' }}>
          <div className="koma-annotation-dot" />
          <div className="koma-annotation-line" />
          <span className="koma-annotation-text">01 / MAPA DE MESAS EM TEMPO REAL</span>
        </div>

        <div className="koma-annotation" style={{ top: '-24px', right: '10%' }}>
          <div className="koma-annotation-dot" />
          <div className="koma-annotation-line" />
          <span className="koma-annotation-text">02 / STATUS DA OPERAÇÃO</span>
        </div>

        <DesktopFrame view="mesas" />
      </motion.div>
    </section>
  );
}
