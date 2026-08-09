import React from 'react';
import { motion } from 'motion/react';

const VALUES = [
  {
    num: '01',
    label: 'ENTRA',
    title: 'BALCÃO, GARÇOM OU QR CODE',
    text: 'Três portas de entrada. Uma única informação.',
  },
  {
    num: '02',
    label: 'CIRCULA',
    title: 'SALÃO E COZINHA VEEM O MESMO STATUS',
    text: 'O pedido avança sem alguém precisar repeti-lo.',
  },
  {
    num: '03',
    label: 'FECHA',
    title: 'CONTA E CAIXA COM O HISTÓRICO INTEIRO',
    text: 'Tudo permanece conectado até o fechamento.',
  },
];

export function ValueStrip() {
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
          <p className="koma-value-intro">01 / UMA ENTRADA. UMA OPERAÇÃO.</p>
          <h2 id="value-title">UM PEDIDO<br />ENTRA UMA VEZ.</h2>
          <p className="koma-value-lead">
            Balcão, garçom ou cliente registram. Depois disso, o Kôma distribui a mesma informação para todo o restaurante.
          </p>
        </motion.div>

        <motion.aside
          className="koma-value-order"
          aria-label="Exemplo de pedido entrando no Kôma"
          initial={{ opacity: 0, x: 28, rotate: 1.5 }}
          whileInView={{ opacity: 1, x: 0, rotate: -1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.62, delay: 0.08 }}
        >
          <div className="koma-value-order-head">
            <div>
              <span>NOVO PEDIDO</span>
              <strong>#0412</strong>
            </div>
            <b>AGORA</b>
          </div>
          <div className="koma-value-order-meta">
            <span>MESA 04</span>
            <span>3 PESSOAS</span>
            <span>SALÃO</span>
          </div>
          <div className="koma-value-order-items">
            <p><span>02</span>Kôma Smash Bacon</p>
            <p><span>01</span>Batata rústica</p>
            <p><span>01</span>Suco de laranja</p>
          </div>
          <div className="koma-value-order-foot">
            <i aria-hidden="true" />
            DISTRIBUINDO PARA A OPERAÇÃO
          </div>
        </motion.aside>
      </div>

      <div className="koma-value-grid" aria-label="Caminho do pedido">
        {VALUES.map((value) => (
          <article className="koma-value-item" key={value.num}>
            <div className="koma-value-item-top">
              <span>{value.num}</span>
              <small>{value.label}</small>
            </div>
            <h2>{value.title}</h2>
            <p>{value.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
