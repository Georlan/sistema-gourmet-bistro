import React from 'react';
import { LifeBuoy, MonitorSmartphone, Wrench } from 'lucide-react';

const ASSURANCES = [
  { icon: MonitorSmartphone, title: 'USE O QUE JÁ TEM', text: 'Celular, tablet ou computador.' },
  { icon: Wrench, title: 'CONFIRA ANTES', text: 'Equipamentos avaliados antes da contratação.' },
  { icon: LifeBuoy, title: 'COMECE ACOMPANHADO', text: 'Configuração e orientação para a equipe.' },
] as const;

const QUESTIONS = [
  {
    question: 'PRECISO TROCAR MEUS EQUIPAMENTOS?',
    answer: 'Não necessariamente. Conferimos computador, tablet, conexão e impressão antes da contratação. Se algo não for compatível, você fica sabendo antes de começar.',
  },
  {
    question: 'QUANTO TEMPO LEVA PARA COMEÇAR?',
    answer: 'Depende do cardápio, da equipe e dos equipamentos. Primeiro entendemos sua rotina; depois combinamos cadastro, configuração e orientação sem interromper o atendimento.',
  },
  {
    question: 'PRECISA DE INTERNET?',
    answer: 'Sim. A conexão mantém caixa, salão e cozinha sincronizados. Durante a implantação, avaliamos o Wi-Fi e orientamos a melhor forma de reduzir riscos na operação.',
  },
  {
    question: 'COMO FUNCIONA O SUPORTE?',
    answer: 'A implantação é acompanhada e as dúvidas operacionais são orientadas conforme o plano contratado e a etapa do restaurante.',
  },
  {
    question: 'FUNCIONA EM CELULAR, TABLET E COMPUTADOR?',
    answer: 'Sim. O Kôma funciona pelo navegador e adapta as telas para cada função. Periféricos específicos são confirmados antes da contratação.',
  },
];

export function FAQ() {
  return (
    <section className="koma-faq-section koma-faq-section--sales" id="duvidas" aria-labelledby="faq-title">
      <div className="koma-faq-sales-heading">
        <div>
          <span>07 / ANTES DE DECIDIR</span>
          <h2 id="faq-title">O QUE VOCÊ PRECISA SABER.</h2>
        </div>
        <p>Sem resposta escondida. Você entende o encaixe, os equipamentos e a implantação antes de contratar.</p>
      </div>

      <div className="koma-faq-assurances" aria-label="Garantias antes de contratar">
        {ASSURANCES.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.title}>
              <Icon size={22} strokeWidth={1.7} aria-hidden="true" />
              <div><strong>{item.title}</strong><span>{item.text}</span></div>
            </article>
          );
        })}
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
