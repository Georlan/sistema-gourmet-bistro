import React from 'react';

const RELIABILITY_ITEMS = [
  ['01', 'IMPRESSÃO ACOMPANHADA', 'Status da conexão e da fila de impressão visíveis para a operação.'],
  ['02', 'EQUIPE COM PERMISSÕES', 'Cada função acessa o que precisa para trabalhar com segurança.'],
  ['03', 'OPERAÇÃO EM TEMPO REAL', 'Mesas e pedidos compartilham o mesmo estado entre as telas.'],
  ['04', 'FECHAMENTO ORGANIZADO', 'Turno, sangria, suprimento e conferência reunidos no caixa.'],
];

export function Reliability() {
  return (
    <section id="impressao" className="koma-reliability-section" aria-labelledby="reliability-title">
      <div className="koma-reliability-title-wrap">
        <span>06 / FEITO PARA A OPERAÇÃO REAL</span>
        <h2 id="reliability-title">QUANDO O MOVIMENTO<br />AUMENTA, O FLUXO<br />CONTINUA.</h2>
      </div>

      <div className="koma-reliability-list">
        {RELIABILITY_ITEMS.map(([num, title, description]) => (
          <article key={num}>
            <span>{num}</span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
