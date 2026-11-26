import React from 'react';

const QUESTIONS = [
  {
    question: 'O KÔMA é um sistema de gestão completo para restaurantes?',
    answer: 'Sim. O KÔMA reúne frente de caixa, mesas, comandas, pedidos de balcão, retirada, delivery e fechamento de turno. Estoque, custo dos pratos, aplicativo do entregador e relatórios completos estão disponíveis nos planos Pro e Premium.',
  },
  {
    question: 'Como funcionam as mesas e comandas digitais no App do Garçom?',
    answer: 'No salão, sua equipe acompanha mesas e comandas pelo App do Garçom no navegador, com informações sincronizadas ao PDV e ao caixa. O recurso está incluído desde o Pocket.',
  },
  {
    question: 'O KÔMA atende restaurantes pequenos com delivery próprio?',
    answer: 'Sim. O Pocket reúne atendimento, caixa, cardápio digital e delivery próprio com 0% de comissão KÔMA sobre pedidos online. Há mensalidade e tarifas de processamento de pagamento cobradas por terceiros, quando aplicáveis.',
  },
  {
    question: 'O cardápio digital aceita pedidos sem WhatsApp?',
    answer: 'Sim. Seu cliente acessa o cardápio pelo link ou QR Code e faz o pedido pelo checkout web. O pedido chega ao PDV do restaurante. Pedidos recebidos por WhatsApp ou telefone são lançados pela equipe.',
  },
  {
    question: 'Preciso comprar uma impressora?',
    answer: 'Não. No Pocket, você acompanha a fila de preparo na tela. Para impressão automática no Pro ou Premium, conferimos o modelo e a conexão da sua impressora antes da contratação.',
  },
  {
    question: 'Posso atender mesas e delivery juntos?',
    answer: 'Sim, inclusive no Pocket. Os pedidos do cardápio digital chegam pelo checkout web integrado (o cliente não precisa de WhatsApp para comprar); pedidos de WhatsApp ou telefone são lançados por você. O delivery com endereço, taxa e status funciona em todos os planos. O app do entregador faz parte do Pro e do Premium.',
  },
  {
    question: 'Tem taxa de implantação, comissão ou módulos extras?',
    answer: 'A implantação padrão é gratuita e a comissão KÔMA sobre pedidos próprios é 0% em todos os planos. Se preferir, oferecemos Implantação VIP opcional por R$ 299,00 (cadastro de até 80 produtos e sessão remota de configuração). Módulos especializados futuros serão opcionais após homologação.',
  },
  {
    question: 'Precisa de internet?',
    answer: 'Sim. A conexão mantém caixa, salão e cozinha sincronizados. Na configuração inicial, avaliamos a conexão e os equipamentos para orientar o uso.',
  },
  {
    question: 'Quanto tempo leva para começar?',
    answer: 'Depende do cardápio, da equipe e dos equipamentos. O período de teste de 7 dias grátis no componente fixo só começa após a implantação dos 4 itens essenciais e liberação pelo SuperAdmin.',
  },
  {
    question: 'Como funciona o suporte?',
    answer: 'Você recebe orientação na configuração inicial e no uso do sistema. Os canais e horários são combinados na contratação. O suporte prioritário do Premium não é plantão 24 horas.',
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
