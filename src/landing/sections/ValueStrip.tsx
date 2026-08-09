import React, { useState } from 'react';
import { motion } from 'motion/react';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const VALUES = [
  {
    num: '01',
    label: 'REGISTRA',
    title: 'BALCÃO, GARÇOM OU QR CODE',
    text: 'O pedido entra por qualquer canal e passa a ter uma única fonte.',
  },
  {
    num: '02',
    label: 'DISTRIBUI',
    title: 'COZINHA E SALÃO RECEBEM O MESMO PEDIDO',
    text: 'Itens, observações e status seguem juntos sem depender de repasse verbal.',
  },
  {
    num: '03',
    label: 'FECHA',
    title: 'O CAIXA RECEBE O HISTÓRICO COMPLETO',
    text: 'Consumo e movimentações permanecem ligados à mesa até o pagamento.',
  },
];

export function ValueStrip() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <section className="koma-value-strip" aria-labelledby="value-title">
      <div className="koma-value-heading">
        <motion.div
          className="koma-value-copy"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.45 }}
          transition={{ duration: 0.55 }}
        >
          <p className="koma-value-intro">01 / O CUSTO DA INFORMAÇÃO PERDIDA</p>
          <h2 id="value-title">UM PEDIDO NÃO DEVERIA SER REPETIDO.</h2>
          <p className="koma-value-lead">
            Quando salão, cozinha e caixa trabalham com informações diferentes, pedidos se perdem, mesas esperam e o fechamento exige conferência manual.
          </p>

          <div className="koma-value-cta">
            <button type="button" className="koma-btn koma-btn--primary" onClick={() => setLeadModalOpen(true)}>
              VER ESSE FLUXO FUNCIONANDO
            </button>
            <small>Demonstração aplicada à rotina do seu restaurante.</small>
          </div>
        </motion.div>

        <motion.aside
          className="koma-value-order"
          aria-label="Exemplo do retrabalho causado por informações separadas"
          initial={{ opacity: 0, x: 28, rotate: 1.5 }}
          whileInView={{ opacity: 1, x: 0, rotate: -1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.62, delay: 0.08 }}
        >
          <div className="koma-value-order-head">
            <div>
              <span>INFORMAÇÕES SEPARADAS</span>
              <strong>#0412</strong>
            </div>
            <b>RISCO</b>
          </div>
          <div className="koma-value-order-meta">
            <span>MESA 04</span>
            <span>PEDIDO ABERTO</span>
            <span>SEM FONTE ÚNICA</span>
          </div>
          <div className="koma-value-problem-list">
            <div>
              <span>01</span>
              <p><strong>PEDIDO REPASSADO</strong><small>O garçom precisa repetir os itens.</small></p>
            </div>
            <div>
              <span>02</span>
              <p><strong>COZINHA CONFIRMA</strong><small>A produção interrompe para tirar dúvidas.</small></p>
            </div>
            <div>
              <span>03</span>
              <p><strong>CAIXA RECONFERE</strong><small>O fechamento depende de revisão manual.</small></p>
            </div>
          </div>
          <div className="koma-value-resolution">
            <span>COM KÔMA</span>
            <strong>UM REGISTRO ATUALIZA A OPERAÇÃO.</strong>
            <p>Cozinha, salão e caixa acompanham o mesmo pedido até o pagamento.</p>
          </div>
        </motion.aside>
      </div>

      <div className="koma-value-grid" aria-label="Caminho do pedido">
        {VALUES.map((value) => (
          <motion.article
            className="koma-value-item"
            key={value.num}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.45 }}
            transition={{ duration: 0.45, delay: Number(value.num) * 0.06 }}
          >
            <div className="koma-value-item-top">
              <span>{value.num}</span>
              <small>{value.label}</small>
            </div>
            <h2>{value.title}</h2>
            <p>{value.text}</p>
          </motion.article>
        ))}
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </section>
  );
}
