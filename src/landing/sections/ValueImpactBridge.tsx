import React from 'react';
import { motion } from 'motion/react';

const OPERATION_POINTS = ['MESAS', 'COZINHA', 'CAIXA', 'SUA VISÃO'];

export function ValueImpactBridge() {
  return (
    <section className="koma-value-impact-bridge" aria-labelledby="value-impact-title">
      <div className="koma-value-impact-green" aria-hidden="true" />
      <motion.div
        className="koma-value-impact-line"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, amount: 0.55 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden="true"
      />

      <div className="koma-value-impact-inner">
        <motion.div
          className="koma-value-impact-copy koma-value-impact-copy--problem"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.65 }}
          transition={{ duration: 0.48 }}
        >
          <span>CONTROLE SEM CORRERIA</span>
          <h2 id="value-impact-title">VOCÊ NÃO PRECISA CORRER ATRÁS DA OPERAÇÃO.</h2>
        </motion.div>

        <motion.div
          className="koma-value-impact-copy koma-value-impact-copy--answer"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.55 }}
          transition={{ duration: 0.52, delay: 0.14 }}
        >
          <span>COM KÔMA</span>
          <p>O KÔMA MOSTRA</p>
          <strong>ONDE AGIR.</strong>
        </motion.div>

        <ol className="koma-value-impact-route" aria-label="Informação da operação reunida em uma única visão">
          {OPERATION_POINTS.map((point, index) => (
            <motion.li
              key={point}
              className={index === OPERATION_POINTS.length - 1 ? 'is-destination' : undefined}
              initial={{ opacity: 0, x: -10 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, amount: 0.7 }}
              transition={{ duration: 0.35, delay: 0.18 + index * 0.09 }}
            >
              <i aria-hidden="true" />
              <span>{point}</span>
            </motion.li>
          ))}
        </ol>
      </div>
    </section>
  );
}
