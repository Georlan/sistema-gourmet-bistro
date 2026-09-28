import React from 'react';
const questions = [
  ['Preciso comprar uma impressora?', 'Não para acompanhar a fila de preparo na tela. Impressão automática faz parte do Pro e Premium. A compatibilidade do equipamento é conferida quando esse recurso se aplica.'],
  ['Precisa de internet?', 'Sim. A conexão mantém caixa, atendimento e cozinha sincronizados. Na configuração inicial, avaliamos a conexão e os equipamentos para orientar o uso.'],
  ['Quando começam os sete dias de teste?', 'Nos planos elegíveis, após a implantação essencial e a liberação para uso. O teste isenta o componente fixo por sete dias; a taxa KÔMA continua aplicável quando houver pedido online pago elegível.'],
  ['Existem outros custos além da mensalidade?', 'Há a taxa KÔMA por pedido online pago, conforme o plano. Custos do provedor de pagamento são separados. A oferta atual não cobra implantação nem vende módulos avulsos.'],
  ['Como começo e como funciona o suporte?', 'A equipe orienta a configuração inicial. O prazo de início, os canais e os horários de suporte são definidos na contratação. O suporte prioritário do Premium não é plantão 24 horas.'],
];
export function FAQ() { return <section className="v2-section v2-faq" id="duvidas" aria-labelledby="faq-title"><div className="v2-wrap"><div className="v2-section-heading" data-reveal><p className="v2-eyebrow">Dúvidas essenciais</p><h2 id="faq-title">Antes de começar.</h2></div><div className="v2-faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></div></section>; }
