import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const FRAGMENTED_STEPS = [
  { num: '01', title: 'ANOTA', text: 'Papel, mensagem ou memória.' },
  { num: '02', title: 'REPASSA', text: 'Alguém avisa a cozinha.' },
  { num: '03', title: 'CONFIRMA', text: 'O salão pergunta o status.' },
  { num: '04', title: 'RELANÇA', text: 'O caixa refaz o histórico.' },
];

const KOMA_STEPS = [
  { num: '01', title: 'REGISTRA UMA VEZ', text: 'Retirada, delivery, garçom ou cardápio digital.' },
  { num: '02', title: 'TODOS ACOMPANHAM', text: 'Salão, cozinha e caixa veem o mesmo status.' },
  { num: '03', title: 'FECHA COM HISTÓRICO', text: 'Tudo permanece ligado ao pedido.' },
];

const OUTCOMES = [
  { value: '1', label: 'ÚNICO REGISTRO', text: 'O pedido não precisa ser digitado de novo.' },
  { value: '3', label: 'ÁREAS CONECTADAS', text: 'Salão, cozinha e caixa acompanham juntos.' },
  { value: '0', label: 'PEDIDOS REPETIDOS', text: 'A informação segue até o pagamento.' },
];

export function ValueStrip() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <section className="koma-value-strip" aria-labelledby="value-title">
      <motion.header
        className="koma-value-header"
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.55 }}
        transition={{ duration: 0.55 }}
      >
        <p className="koma-value-intro">01 / MENOS RETRABALHO</p>
        <h2 id="value-title">UM PEDIDO.<br /><span>75% MENOS ETAPAS.</span></h2>
        <p>
          Neste fluxo, quatro intervenções manuais viram um único registro. O restaurante ganha agilidade sem perder o controle.
        </p>
      </motion.header>

      <div className="koma-value-comparison" aria-label="Comparação entre uma operação fragmentada e uma operação com Kôma">
        <motion.article
          className="koma-value-lane koma-value-lane--fragmented"
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.6 }}
        >
          <div className="koma-value-lane-head">
            <div>
              <small>SEM SISTEMA</small>
              <strong>#0412</strong>
            </div>
            <span>4 ETAPAS MANUAIS</span>
          </div>

          <div className="koma-value-route">
            {FRAGMENTED_STEPS.map((step) => (
              <div className="koma-value-route-step" key={step.num}>
                <i aria-hidden="true" />
                <span>{step.num}</span>
                <p><strong>{step.title}</strong><small>{step.text}</small></p>
              </div>
            ))}
          </div>

          <div className="koma-value-lane-foot">
            <small>RESULTADO</small>
            <strong>O MESMO PEDIDO PASSA POR VÁRIAS PESSOAS.</strong>
          </div>
        </motion.article>

        <div className="koma-value-versus" aria-hidden="true"><span>VS</span></div>

        <motion.article
          className="koma-value-lane koma-value-lane--koma"
          initial={{ opacity: 0, x: 28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.6, delay: 0.08 }}
        >
          <div className="koma-value-lane-head">
            <div>
              <small>COM KÔMA</small>
              <strong>#0412</strong>
            </div>
            <span>1 REGISTRO</span>
          </div>

          <div className="koma-value-route">
            {KOMA_STEPS.map((step) => (
              <div className="koma-value-route-step" key={step.num}>
                <i aria-hidden="true" />
                <span>{step.num}</span>
                <p><strong>{step.title}</strong><small>{step.text}</small></p>
              </div>
            ))}
          </div>

          <div className="koma-value-lane-foot">
            <small>RESULTADO</small>
            <strong>UM REGISTRO MANTÉM O RESTAURANTE SINCRONIZADO.</strong>
          </div>
        </motion.article>
      </div>

      <div className="koma-value-outcomes">
        {OUTCOMES.map((outcome) => (
          <article key={outcome.value}>
            <span>{outcome.value}</span>
            <div><strong>{outcome.label}</strong><p>{outcome.text}</p></div>
          </article>
        ))}
        <div className="koma-value-action">
          <p>Veja quanto trabalho o Kôma pode retirar da sua rotina.</p>
          <button type="button" className="koma-btn koma-btn--primary" onClick={() => setLeadModalOpen(true)}>
            VER O KÔMA FUNCIONANDO
          </button>
        </div>
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </section>
  );
}
