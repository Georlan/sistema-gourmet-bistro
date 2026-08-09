import React, { useState } from 'react';
import { motion } from 'motion/react';
import logoOnGreen from '../../assets/logo-koma-on-green.png';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const TURN_METRICS = [
  { value: '12', label: 'MESAS EM ATENDIMENTO' },
  { value: '03', label: 'PEDIDOS EM PRODUÇÃO' },
  { value: '01', label: 'PRECISA DE ATENÇÃO', attention: true },
];

const TURN_STATUS = [
  { area: 'ATENÇÃO AGORA', detail: 'MESA 12 SEM ATUALIZAÇÃO HÁ 14 MIN', status: 'VER', attention: true },
  { area: 'COZINHA', detail: '3 PEDIDOS EM PREPARO', status: 'NORMAL' },
  { area: 'CAIXA', detail: 'MESA 04 PRONTA PARA FECHAR', status: 'PRONTO' },
];

export function ImpactMoment() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <section className="koma-impact-section" aria-labelledby="impact-title">
      <div className="koma-impact-grid" aria-hidden="true" />
      <div className="koma-impact-topline">
        <span className="koma-impact-eyebrow">02 / CONTROLE DO TURNO</span>
        <span>VISÃO AO VIVO / EXEMPLO DE OPERAÇÃO</span>
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
            SE ATRASAR.<br />
            VOCÊ VÊ.
          </h2>
          <p className="koma-impact-copy">
            Mesas, pedidos e produção em uma visão simples. O Kôma mostra o que precisa da sua atenção antes que o cliente reclame.
          </p>
          <button type="button" className="koma-btn koma-btn--dark koma-impact-cta" onClick={() => setLeadModalOpen(true)}>
            QUERO ESSA VISÃO NO MEU RESTAURANTE
          </button>
          <small className="koma-impact-cta-note">Demonstração rápida e sem compromisso.</small>
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
              <span>VISÃO DO TURNO</span>
              <strong>O QUE PRECISA DA SUA ATENÇÃO</strong>
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

          <div className="koma-impact-signals">
            {TURN_STATUS.map((item, index) => (
              <motion.div
                key={item.area}
                className={item.attention ? 'koma-impact-signal--attention' : undefined}
                initial={{ opacity: 0, x: 14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.32, delay: 0.28 + index * 0.1 }}
              >
                <span>{item.area}</span>
                <p>{item.detail}</p>
                <strong>{item.status}</strong>
              </motion.div>
            ))}
          </div>

          <div className="koma-impact-console-foot">
            <span><i aria-hidden="true" />OPERAÇÃO ACOMPANHADA</span>
            <strong>SAIBA ONDE AGIR PRIMEIRO</strong>
          </div>
        </motion.div>
      </div>

      <div className="koma-impact-proof" aria-label="Benefícios da visão do turno">
        <span>ATRASOS VISÍVEIS</span>
        <span>PRIORIDADES CLARAS</span>
        <span>MENOS SURPRESAS NO TURNO</span>
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </section>
  );
}
