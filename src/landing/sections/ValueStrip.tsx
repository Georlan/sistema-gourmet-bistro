import React from 'react';
import { motion } from 'motion/react';

const FRAGMENTED_STEPS = [
  { num: '01', title: 'ANOTA O PEDIDO', text: 'Itens e observações ficam separados do restante da operação.' },
  { num: '02', title: 'REPASSA À COZINHA', text: 'A produção depende de alguém levar ou repetir a informação.' },
  { num: '03', title: 'CONFERE O STATUS', text: 'O salão precisa parar para perguntar se o pedido está pronto.' },
  { num: '04', title: 'REFAZ A CONTA', text: 'No caixa, o consumo precisa ser reunido e conferido novamente.' },
];

const KOMA_STEPS = [
  { num: '01', title: 'REGISTRA UMA VEZ', text: 'O pedido entra pelo salão, balcão, delivery ou cardápio digital.' },
  { num: '02', title: 'A OPERAÇÃO ACOMPANHA', text: 'Salão, cozinha e caixa enxergam o mesmo pedido e o mesmo status.' },
  { num: '03', title: 'FECHA COM HISTÓRICO', text: 'Itens, alterações e pagamento continuam ligados até o fechamento.' },
];

const OUTCOMES = [
  { value: '01', label: 'UMA ÚNICA ENTRADA', text: 'O pedido não precisa ser digitado novamente.' },
  { value: '→', label: 'STATUS COMPARTILHADO', text: 'A equipe acompanha a mesma informação enquanto ela acontece.' },
  { value: '✓', label: 'HISTÓRICO COMPLETO', text: 'O consumo continua ligado ao pedido até o pagamento.' },
];

export function ValueStrip() {
  return (
    <section className="koma-value-strip" aria-labelledby="value-title">
      <motion.header
        className="koma-value-header"
        initial={{ opacity: 0, y: 22 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.55 }}
        transition={{ duration: 0.55 }}
      >
        <p className="koma-value-intro">01 / ANTES E DEPOIS</p>
        <h2 id="value-title">O MESMO PEDIDO.<br /><span>OUTRA OPERAÇÃO.</span></h2>
        <p>
          Compare o custo dos repasses manuais com um fluxo em que todos acompanham a mesma informação.
        </p>
      </motion.header>

      <div className="koma-value-comparison" aria-label="Comparação entre operar sem Kôma e operar com Kôma">
        <motion.article
          className="koma-value-lane koma-value-lane--fragmented"
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.6 }}
        >
          <div className="koma-value-lane-head">
            <div>
              <strong>SEM KÔMA</strong>
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
            <strong>MAIS REPASSE. MAIS CHANCE DE ERRO. MENOS VISÃO DA OPERAÇÃO.</strong>
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
              <strong>COM KÔMA</strong>
            </div>
            <span>1 FLUXO</span>
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
            <strong>MENOS RETRABALHO. RESPOSTA MAIS RÁPIDA. CONTROLE DO INÍCIO AO FIM.</strong>
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
          <p>Veja cada área recebendo o mesmo pedido, sem depender de novos repasses.</p>
          <a className="koma-btn koma-btn--primary" href="#como-funciona">
            VER O FLUXO COMPLETO
          </a>
        </div>
      </div>
    </section>
  );
}
