import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const FRAGMENTED_STEPS = [
  { num: '01', title: 'ANOTA', text: 'O pedido nasce em um canal.' },
  { num: '02', title: 'REPASSA', text: 'Alguém precisa informar a cozinha.' },
  { num: '03', title: 'CONFIRMA', text: 'O salão pergunta se está pronto.' },
  { num: '04', title: 'RECONFERE', text: 'O caixa reconstrói o histórico.' },
];

const KOMA_STEPS = [
  { num: '01', title: 'REGISTRA', text: 'Balcão, garçom ou QR Code.' },
  { num: '02', title: 'SINCRONIZA', text: 'Salão, cozinha e caixa veem o status.' },
  { num: '03', title: 'FECHA', text: 'O histórico acompanha o pagamento.' },
];

const OUTCOMES = [
  { num: '01', label: 'UMA FONTE', text: 'Itens e observações permanecem no mesmo pedido.' },
  { num: '02', label: 'STATUS VISÍVEL', text: 'Cada área sabe o que aconteceu e o que vem agora.' },
  { num: '03', label: 'HISTÓRICO COMPLETO', text: 'A informação chega ao caixa sem ser reconstruída.' },
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
        <p className="koma-value-intro">01 / DOIS JEITOS DE OPERAR</p>
        <h2 id="value-title">O MESMO PEDIDO.<br /><span>DOIS RESULTADOS.</span></h2>
        <p>
          O custo aparece quando a informação precisa ser repetida. Veja como o Kôma reduz etapas e mantém toda a operação acompanhando o mesmo pedido.
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
              <small>OPERAÇÃO FRAGMENTADA</small>
              <strong>#0412</strong>
            </div>
            <span>4 REPASSES</span>
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
            <strong>MAIS DEPENDÊNCIA DE MEMÓRIA E CONFERÊNCIA.</strong>
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
              <small>OPERAÇÃO COM KÔMA</small>
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
            <strong>MENOS RETRABALHO. MAIS CAPACIDADE PARA ATENDER.</strong>
          </div>
        </motion.article>
      </div>

      <div className="koma-value-outcomes">
        {OUTCOMES.map((outcome) => (
          <article key={outcome.num}>
            <span>{outcome.num}</span>
            <div><strong>{outcome.label}</strong><p>{outcome.text}</p></div>
          </article>
        ))}
        <div className="koma-value-action">
          <p>Veja essa diferença aplicada à rotina do seu restaurante.</p>
          <button type="button" className="koma-btn koma-btn--primary" onClick={() => setLeadModalOpen(true)}>
            VER O KÔMA FUNCIONANDO
          </button>
        </div>
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </section>
  );
}
