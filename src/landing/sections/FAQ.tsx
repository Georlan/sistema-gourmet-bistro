import React from 'react';

const QUESTIONS = [
  {
    question: 'PRECISO TROCAR MINHA IMPRESSORA?',
    answer: 'Não necessariamente. Antes da contratação, conferimos o modelo, a conexão e o fluxo de impressão que você usa. Se algum equipamento não for compatível, você recebe essa informação antes da implantação.',
  },
  {
    question: 'FUNCIONA SEM INTERNET NO SALÃO?',
    answer: 'A conexão com a internet é necessária para manter caixa, salão e cozinha sincronizados. Na implantação, avaliamos o Wi-Fi do estabelecimento e orientamos uma contingência adequada para a sua operação.',
  },
  {
    question: 'QUANTO TEMPO LEVA PARA COMEÇAR?',
    answer: 'Depende do tamanho do cardápio, da equipe e dos equipamentos. Primeiro entendemos sua rotina; depois combinamos cadastro, configuração e treinamento sem interromper o atendimento.',
  },
  {
    question: 'COMO FUNCIONA O SUPORTE?',
    answer: 'O contato começa pelo WhatsApp e a implantação é acompanhada. Dúvidas operacionais e ajustes são orientados de acordo com o plano e com a etapa de implantação do restaurante.',
  },
  {
    question: 'O KÔMA FUNCIONA EM CELULAR, TABLET E COMPUTADOR?',
    answer: 'Sim. As telas são responsivas e cada perfil usa a interface adequada à função. A compatibilidade com maquininhas e periféricos específicos é confirmada antes da contratação.',
  },
];

export function FAQ() {
  return (
    <section className="koma-faq-section" id="duvidas" aria-labelledby="faq-title">
      <div className="koma-faq-heading">
        <span>05 / DÚVIDAS ANTES DE COMEÇAR</span>
        <h2 id="faq-title">SEM LETRAS<br />MIÚDAS.</h2>
        <p>As respostas que você precisa para avaliar o Kôma sem comprar no escuro.</p>
      </div>

      <div className="koma-faq-list">
        {QUESTIONS.map((item, index) => (
          <details key={item.question} open={index === 0}>
            <summary>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{item.question}</strong>
              <i aria-hidden="true" />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
