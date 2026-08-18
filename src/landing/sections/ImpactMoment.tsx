import React from 'react';
import { motion } from 'motion/react';
import { KOMA_WORDMARK_SRC } from '../../brand/komaBrand';

const TURN_METRICS = [
  { value: '12', label: 'MESAS EM ATENDIMENTO' },
  { value: '3', label: 'PEDIDOS EM PREPARO' },
  { value: '1', label: 'ATRASO', attention: true },
];

export function ImpactMoment() {
  return (
    <section className="koma-impact-section" aria-labelledby="impact-title">
      <div className="koma-impact-grid" aria-hidden="true" />
      <div className="koma-impact-topline">
        <span className="koma-impact-eyebrow">03 / CONTROLE DO TURNO</span>
        <span>ATUALIZAÇÃO EM TEMPO REAL</span>
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
            <span>SE ALGO</span>
            <span>ATRASAR.</span>
            <span>VOCÊ VÊ.</span>
          </h2>
          <p className="koma-impact-copy">
            Acompanhe mesas, pedidos e produção em uma única visão. O Kôma destaca o que precisa da sua atenção antes que o cliente reclame.
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
            <img
              src={KOMA_WORDMARK_SRC}
              alt=""
              aria-hidden="true"
              style={{ width: 'clamp(86px, 8vw, 118px)', height: 'auto', objectFit: 'contain' }}
            />
            <div>
              <span>AGORA NO RESTAURANTE</span>
              <strong>RESUMO DA OPERAÇÃO</strong>
            </div>
            <b>AGORA</b>
          </div>

          <div className="koma-impact-metrics" aria-label="Resumo da operação">
            {TURN_METRICS.map((metric, index) => (
              <motion.div
                key={metric.label}
                className={metric.attention ? 'koma-impact-metric koma-impact-metric--attention' : 'koma-impact-metric'}
                initial={{ opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.35, delay: 0.16 + index * 0.08 }}
              >
                <strong>{metric.value}</strong>
                <span>{metric.label}</span>
              </motion.div>
            ))}
          </div>

          <motion.div
            className="koma-impact-alert"
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 0.38, delay: 0.4 }}
          >
            <div>
              <span>PRECISA DE ATENÇÃO</span>
              <strong>MESA 12 SEM ATUALIZAÇÃO</strong>
              <p>Atendimento acima do tempo esperado</p>
            </div>
            <b>18 MIN</b>
          </motion.div>

          <div className="koma-impact-normal">
            <i aria-hidden="true" />
            <span>O RESTANTE DA OPERAÇÃO ESTÁ DENTRO DO TEMPO ESPERADO</span>
          </div>
        </motion.div>
      </div>

      <div className="koma-impact-proof" aria-label="Benefícios da visão do turno">
        <span><b>01</b><strong>ATRASOS VISÍVEIS</strong></span>
        <span><b>02</b><strong>PRIORIDADES CLARAS</strong></span>
        <span><b>03</b><strong>MENOS SURPRESAS NO TURNO</strong></span>
      </div>
    </section>
  );
}
