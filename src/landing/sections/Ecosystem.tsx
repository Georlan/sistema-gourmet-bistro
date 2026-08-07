import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import { DesktopFrame } from '../product/DesktopFrame';
import { TabletFrame } from '../product/TabletFrame';
import { PhoneFrame } from '../product/PhoneFrame';

export function Ecosystem() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.15 });

  return (
    <section ref={ref} className="koma-ecosystem-section" aria-label="Ecossistema">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8 }}
      >
        <h2 className="koma-eco-title">
          TUDO ONDE<br />PRECISA ESTAR.
        </h2>
        <p className="koma-eco-subtitle">
          PDV Balcão. Gestão de Mesas. KDS Cozinha. Cardápio Digital. Delivery. Impressão Automática.
        </p>
      </motion.div>

      {/* Overlapped Physical Devices Composition (Nixon + KÔMA Full Bleed) */}
      <div className="koma-eco-stage">
        {/* Dominant Monitor Object (~800px) */}
        <motion.div
          className="koma-eco-monitor"
          initial={{ opacity: 0, x: 60 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 1, delay: 0.1 }}
        >
          <DesktopFrame view="mesas" />
        </motion.div>

        {/* Overlapping Tablet Object (~420px) */}
        <motion.div
          className="koma-eco-tablet"
          initial={{ opacity: 0, y: 50 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, delay: 0.25 }}
        >
          <TabletFrame view="mesas" />
        </motion.div>

        {/* Foreground Smartphone Object (~250px) */}
        <motion.div
          className="koma-eco-phone"
          initial={{ opacity: 0, y: 70 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, delay: 0.4 }}
        >
          <PhoneFrame />
        </motion.div>
      </div>

      {/* Pure Editorial Labels directly in composition (NO cards/boxes) */}
      <div className="koma-eco-labels-grid">
        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">01 / CAIXA</span>
          <h3 className="koma-eco-label-name">OPERAÇÃO NO BALCÃO</h3>
          <p className="koma-eco-label-desc">Abertura, fechamento, sangrias e emissão fiscal sem complicações.</p>
        </div>

        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">02 / GARÇOM</span>
          <h3 className="koma-eco-label-name">PEDIDO DIRETO DA MESA</h3>
          <p className="koma-eco-label-desc">Lançamento ágil com envio instantâneo para a produção na cozinha.</p>
        </div>

        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">03 / CARDÁPIO</span>
          <h3 className="koma-eco-label-name">AUTONOMIA QR CODE</h3>
          <p className="koma-eco-label-desc">Cardápio digital na mesa para consulta e pedidos sem fila de espera.</p>
        </div>
      </div>
    </section>
  );
}
