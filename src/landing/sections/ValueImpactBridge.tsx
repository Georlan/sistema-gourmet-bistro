import React from 'react';
import { motion } from 'motion/react';

export function ValueImpactBridge() {
  return (
    <section className="koma-value-impact-bridge" aria-labelledby="value-impact-title">
      <div className="koma-value-impact-green" aria-hidden="true" />
      <motion.div
        className="koma-value-impact-line"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        aria-hidden="true"
      />

      <div className="koma-value-impact-inner">
        <motion.div
          className="koma-value-impact-copy"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: 0.58 }}
        >
          <span>DO REGISTRO AO CONTROLE</span>
          <h2 id="value-impact-title">
            MENOS TEMPO<br />PROCURANDO.
            <strong>MAIS TEMPO<br />DECIDINDO.</strong>
          </h2>
          <p>O Kôma transforma cada pedido em informação clara para agir na hora certa.</p>
        </motion.div>

        <motion.article
          className="koma-value-impact-ticket"
          initial={{ opacity: 0, x: -90, y: 36, rotate: -7 }}
          whileInView={{ opacity: 1, x: 0, y: 0, rotate: -2 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.85, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
          aria-label="Pedido 0412 acompanhado em tempo real"
        >
          <div className="koma-value-impact-ticket-top">
            <span>PEDIDO ACOMPANHADO</span>
            <i aria-hidden="true" />
          </div>
          <strong>#0412</strong>
          <div className="koma-value-impact-ticket-status">
            <span>MESA 04</span>
            <span>EM PREPARO</span>
            <b>18 MIN</b>
          </div>
          <small>PRIORIDADE VISÍVEL PARA TODA A OPERAÇÃO</small>
        </motion.article>

        <div className="koma-value-impact-index" aria-hidden="true">
          <span>01</span>
          <i />
          <strong>02</strong>
        </div>
      </div>
    </section>
  );
}
