import React from 'react';
import { motion } from 'motion/react';
import logoOnGreen from '../../assets/logo-koma-on-green.png';

const SIGNALS = [
  ['12:41:08', 'PEDIDO RECEBIDO', 'OK'],
  ['12:41:09', 'KDS DA COZINHA ATUALIZADO', 'OK'],
  ['12:41:10', 'IMPRESSÃO DE PRODUÇÃO ENVIADA', 'OK'],
  ['12:41:11', 'STATUS DA MESA SINCRONIZADO', 'OK'],
];

export function ImpactMoment() {
  return (
    <section className="koma-impact-section" aria-labelledby="impact-title">
      <div className="koma-impact-grid" aria-hidden="true" />
      <div className="koma-impact-topline">
        <span className="koma-impact-eyebrow">02 / RESPOSTA IMEDIATA</span>
        <span>PEDIDO #0412 · MESA 04</span>
      </div>

      <div className="koma-impact-layout">
        <motion.div
          className="koma-impact-copy-block"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: 0.58 }}
        >
          <h2 className="koma-impact-title" id="impact-title">
            PEDIU.<br />
            A COZINHA<br />
            JÁ SABE.
          </h2>
          <p className="koma-impact-copy">
            O pedido certo chega ao lugar certo sem grito no balcão, papel perdido ou informação duplicada.
          </p>
        </motion.div>

        <motion.div
          className="koma-impact-console"
          initial={{ opacity: 0, x: 34 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: 0.62, delay: 0.08 }}
        >
          <div className="koma-impact-console-head">
            <img src={logoOnGreen} alt="" aria-hidden="true" />
            <div>
              <span>FLUXO KÔMA</span>
              <strong>OPERAÇÃO SINCRONIZADA</strong>
            </div>
            <b>AO VIVO</b>
          </div>
          <div className="koma-impact-signals">
            {SIGNALS.map(([time, label, status], index) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, x: 14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.32, delay: 0.18 + index * 0.1 }}
              >
                <time>{time}</time>
                <p>{label}</p>
                <span>{status}</span>
              </motion.div>
            ))}
          </div>
          <div className="koma-impact-console-foot">
            <span><i aria-hidden="true" />4 DESTINOS ATUALIZADOS</span>
            <strong>0 REPETIÇÕES MANUAIS</strong>
          </div>
        </motion.div>
      </div>

      <div className="koma-impact-proof" aria-label="Benefícios do fluxo automático">
        <span>SEM GRITO NO BALCÃO</span>
        <span>SEM PAPEL PERDIDO</span>
        <span>SEM DUPLICAR PEDIDO</span>
      </div>
    </section>
  );
}
