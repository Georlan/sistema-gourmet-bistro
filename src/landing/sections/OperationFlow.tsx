import React, { useState } from 'react';
import { motion } from 'motion/react';

const FLOW_STAGES = [
  {
    id: 'entrada',
    num: '01',
    short: 'ENTRADA',
    title: 'O PEDIDO NASCE UMA VEZ.',
    description: 'Garçom, balcão ou cliente registram o pedido. A partir daí, toda a equipe acompanha a mesma informação.',
    status: 'NOVO PEDIDO',
    context: 'MESA 04 · SALÃO',
    items: ['2× Kôma Smash Bacon', '1× Batata rústica', '1× Suco de laranja'],
    action: 'ENVIADO À PRODUÇÃO',
  },
  {
    id: 'cozinha',
    num: '02',
    short: 'COZINHA',
    title: 'A PRODUÇÃO RECEBE NA HORA.',
    description: 'O KDS organiza a fila e mantém observações e itens visíveis para quem está preparando.',
    status: 'EM PREPARO',
    context: 'KDS · PEDIDO #0412',
    items: ['2× Smash · 1 sem picles', '1× Batata · molho à parte', 'Bebida liberada'],
    action: '04:12 DE PREPARO',
  },
  {
    id: 'salao',
    num: '03',
    short: 'SALÃO',
    title: 'O SALÃO SABE O QUE ESTÁ PRONTO.',
    description: 'O status volta para a operação sem o garçom precisar perguntar à cozinha ou repetir o pedido.',
    status: 'PRONTO PARA SERVIR',
    context: 'MESA 04 · 3 PESSOAS',
    items: ['Pedido principal pronto', 'Bebidas entregues', 'Mesa aberta há 38 min'],
    action: 'CHAMAR GARÇOM',
  },
  {
    id: 'caixa',
    num: '04',
    short: 'CAIXA',
    title: 'A CONTA FECHA COM O HISTÓRICO INTEIRO.',
    description: 'Consumo, pagamentos e movimentações chegam organizados ao fechamento da mesa e do turno.',
    status: 'CONTA SOLICITADA',
    context: 'FECHAMENTO · MESA 04',
    items: ['Subtotal do consumo', 'Taxa de serviço configurada', 'Pagamento registrado'],
    action: 'TOTAL · R$ 184,50',
  },
] as const;

export function OperationFlow() {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = FLOW_STAGES[activeIndex];

  return (
    <section className="koma-flow-section" id="como-funciona" aria-labelledby="flow-title">
      <div className="koma-section-heading koma-section-heading--dark">
        <span>02 / UM PEDIDO, UM FLUXO</span>
        <h2 id="flow-title">A OPERAÇÃO<br />ACOMPANHA.</h2>
        <p>Veja como uma única informação atravessa o restaurante sem se perder pelo caminho.</p>
      </div>

      <div className="koma-flow-layout">
        <div className="koma-flow-tabs" role="tablist" aria-label="Etapas do pedido">
          {FLOW_STAGES.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={activeIndex === index}
              aria-controls="koma-flow-panel"
              className={`koma-flow-tab ${activeIndex === index ? 'koma-flow-tab--active' : ''}`}
              onClick={() => setActiveIndex(index)}
            >
              <span>{stage.num}</span>
              <strong>{stage.short}</strong>
            </button>
          ))}
        </div>

        <div className="koma-flow-content" id="koma-flow-panel" role="tabpanel">
          <motion.div
            className="koma-flow-copy"
            key={`${active.id}-copy`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
          >
            <span>{active.num} / {active.short}</span>
            <h3>{active.title}</h3>
            <p>{active.description}</p>
          </motion.div>

          <motion.div
            className="koma-flow-ticket"
            key={`${active.id}-ticket`}
            initial={{ opacity: 0, x: 18, scale: 0.99 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.24 }}
          >
            <div className="koma-flow-ticket-top">
              <div>
                <small>{active.context}</small>
                <strong>PEDIDO #0412</strong>
              </div>
              <span>{active.status}</span>
            </div>
            <div className="koma-flow-ticket-list">
              {active.items.map((item, index) => (
                <div key={item}>
                  <span>0{index + 1}</span>
                  <p>{item}</p>
                </div>
              ))}
            </div>
            <div className="koma-flow-ticket-action">
              <i aria-hidden="true" />
              <strong>{active.action}</strong>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
