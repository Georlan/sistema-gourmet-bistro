import React from 'react';

const VALUES = [
  {
    num: '01',
    title: 'UM PEDIDO. UMA FONTE.',
    text: 'Balcão, garçom e QR Code alimentam a mesma operação.',
  },
  {
    num: '02',
    title: 'TODOS VEEM O AGORA.',
    text: 'Salão, cozinha e caixa acompanham o mesmo status.',
  },
  {
    num: '03',
    title: 'CONTROLE ATÉ O FIM.',
    text: 'Da abertura da mesa ao fechamento do caixa.',
  },
];

export function ValueStrip() {
  return (
    <section className="koma-value-strip" aria-label="Resumo dos benefícios do Kôma">
      <p className="koma-value-intro">MENOS TROCA DE TELA. MENOS RUÍDO. MAIS OPERAÇÃO.</p>
      <div className="koma-value-grid">
        {VALUES.map((value) => (
          <article className="koma-value-item" key={value.num}>
            <span>{value.num}</span>
            <h2>{value.title}</h2>
            <p>{value.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
