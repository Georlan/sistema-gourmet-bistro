import React from 'react';

const QUESTIONS = [
  {
    question: 'Preciso trocar meus equipamentos?',
    answer: 'Não necessariamente. Antes da contratação, conferimos computadores, impressoras, conexão e o fluxo que você já usa. Se algo não for compatível, você sabe antes da implantação.',
  },
  {
    question: 'Quanto tempo leva para começar?',
    answer: 'O prazo depende do cardápio, da equipe e dos equipamentos. Depois do diagnóstico, combinamos cadastro, configuração e treinamento em etapas para não interromper o atendimento.',
  },
  {
    question: 'Funciona em celular, tablet e computador?',
    answer: 'Sim. O Kôma é responsivo e cada função usa a tela mais adequada. Periféricos específicos e maquininhas são confirmados antes da contratação.',
  },
  {
    question: 'Como funciona o suporte?',
    answer: 'O contato começa pelo WhatsApp e a implantação é acompanhada. Dúvidas operacionais e ajustes são orientados de acordo com o plano contratado.',
  },
];

export function FAQ() {
  return (
    <section className="koma-faq-section" id="duvidas" aria-labelledby="faq-title">
      <div className="koma-container koma-faq-layout">
        <header>
          <p className="koma-eyebrow koma-eyebrow--dark"><span />Dúvidas honestas</p>
          <h2 id="faq-title">Decida com clareza.</h2>
          <p>O que você precisa saber antes de colocar um novo sistema dentro do restaurante.</p>
        </header>
        <div className="koma-faq-list">
          {QUESTIONS.map((item, index) => (
            <details key={item.question} open={index === 0}>
              <summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><i aria-hidden="true" /></summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
