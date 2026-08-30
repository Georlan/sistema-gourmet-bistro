import React from 'react';

const QUESTIONS = [
  {
    question: 'Preciso comprar uma impressora?',
    answer: 'Não. No Pocket, você acompanha a fila de preparo na tela. Para impressão automática no Pro ou Premium, conferimos o modelo e a conexão da sua impressora antes da contratação.',
  },
  {
    question: 'Posso atender mesas e delivery juntos?',
    answer: 'Sim, inclusive no Pocket. Os pedidos do cardápio digital chegam ao Kôma; pedidos de WhatsApp ou telefone são lançados por você. O app do entregador é opcional e não é necessário para fazer delivery.',
  },
  {
    question: 'Precisa de internet?',
    answer: 'Sim. A conexão mantém caixa, salão e cozinha sincronizados. Na implantação, avaliamos a conexão e os equipamentos para orientar o uso.',
  },
  {
    question: 'Quanto tempo leva para começar?',
    answer: 'Depende do cardápio, da equipe e dos equipamentos. Combinamos o prazo e o escopo da implantação antes de contratar.',
  },
  {
    question: 'Como funciona o suporte?',
    answer: 'Você recebe orientação na implantação e no uso do sistema. Os canais e horários são combinados na contratação. O suporte prioritário do Premium não é plantão 24 horas.',
  },
];

export function FAQ() {
  return (
    <section className="koma-faq-section koma-faq-section--sales" id="duvidas" aria-labelledby="faq-title">
      <div className="koma-faq-sales-heading">
        <div><span>06 / DÚVIDAS</span><h2 id="faq-title">ANTES DE COMEÇAR.</h2></div>
        <p>Respostas diretas para você decidir.</p>
      </div>
      <div className="koma-faq-list">
        {QUESTIONS.map((item, index) => (
          <details key={item.question}>
            <summary><span>{String(index + 1).padStart(2, '0')}</span><strong>{item.question}</strong><i aria-hidden="true" /></summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
