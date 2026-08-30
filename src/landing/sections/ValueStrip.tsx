import React from 'react';

const FRAGMENTED_STEPS = [
  { num: '01', title: 'ANOTA O PEDIDO', text: 'Informação em anotações separadas.' },
  { num: '02', title: 'REPASSA À COZINHA', text: 'Alguém precisa levar ou repetir o pedido.' },
  { num: '03', title: 'CONFERE O STATUS', text: 'O salão para para perguntar se está pronto.' },
  { num: '04', title: 'REFAZ A CONTA', text: 'É preciso reunir e conferir o consumo.' },
];

const KOMA_STEPS = [
  { num: '01', title: 'REGISTRA UMA VEZ', text: 'Pelo atendimento ou pelo cardápio digital.' },
  { num: '02', title: 'A OPERAÇÃO ACOMPANHA', text: 'Atendimento, preparo e caixa conectados.' },
  { num: '03', title: 'FECHA COM HISTÓRICO', text: 'Consumo e pagamento no mesmo pedido.' },
];

export function ValueStrip() {
  return (
    <section className="koma-value-strip" aria-labelledby="value-title">
      <header
        className="koma-value-header"
      >
        <p className="koma-value-intro">01 / ANTES E DEPOIS</p>
        <h2 id="value-title">MENOS REPASSE.<br /><span>MAIS CONTROLE.</span></h2>
        <p>
          O pedido entra uma vez. Sua equipe acompanha até o pagamento.
        </p>
      </header>

      <div className="koma-value-comparison" aria-label="Comparação entre operar sem Kôma e operar com Kôma">
        <article
          className="koma-value-lane koma-value-lane--fragmented"
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
            <strong>MAIS TAREFAS PARA A EQUIPE.</strong>
          </div>
        </article>

        <div className="koma-value-versus" aria-hidden="true"><span>VS</span></div>

        <article
          className="koma-value-lane koma-value-lane--koma"
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
            <strong>MENOS RETRABALHO NO ATENDIMENTO.</strong>
          </div>
        </article>
      </div>

      <a className="koma-comparison-link" href="#como-funciona">Veja esse fluxo nas telas do Kôma →</a>
    </section>
  );
}
