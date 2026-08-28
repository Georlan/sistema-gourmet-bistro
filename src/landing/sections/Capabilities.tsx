import React from 'react';
import { ArrowDownRight, Clock3, RotateCcw, WalletCards } from 'lucide-react';

const BENEFITS = [
  {
    num: '01',
    eyebrow: 'MAIS CONTROLE',
    title: 'SAIBA ONDE O DINHEIRO VAI.',
    description: 'Caixa, estoque e relatórios mostram o que vendeu, o que saiu e o que precisa de atenção.',
    items: ['CAIXA E FINANCEIRO', 'ESTOQUE E COMPRAS', 'RELATÓRIOS'],
    result: 'DECIDA COM NÚMEROS, NÃO COM ACHISMO.',
    icon: WalletCards,
    tone: 'dark',
  },
  {
    num: '02',
    eyebrow: 'MAIS RETORNO',
    title: 'DÊ MOTIVOS PARA O CLIENTE VOLTAR.',
    description: 'Histórico, fidelidade e cupons ajudam você a reconhecer quem compra e criar novas visitas.',
    items: ['HISTÓRICO DO CLIENTE', 'FIDELIDADE', 'CUPONS'],
    result: 'A VENDA TERMINA. O RELACIONAMENTO CONTINUA.',
    icon: RotateCcw,
    tone: 'light',
  },
  {
    num: '03',
    eyebrow: 'MAIS TEMPO',
    title: 'DEIXE O SISTEMA FAZER O REPETITIVO.',
    description: 'Delivery, impressão, permissões e avisos mantêm a operação andando com menos cobrança manual.',
    items: ['DELIVERY E MOTOBOY', 'EQUIPE E PERMISSÕES', 'IMPRESSÃO E AVISOS'],
    result: 'MENOS CORRERIA. MAIS TEMPO PARA ATENDER.',
    icon: Clock3,
    tone: 'green',
  },
] as const;

export function Capabilities() {
  return (
    <section className="koma-benefits-section" id="recursos" aria-labelledby="benefits-title">
      <div className="koma-benefits-heading">
        <div>
          <span>05 / MAIS RESULTADO</span>
          <h2 id="benefits-title">MENOS CORRERIA.<br />MAIS CONTROLE.</h2>
        </div>
        <div>
          <p>O Kôma não termina no pedido. Ele ajuda você a cuidar do dinheiro, trazer clientes de volta e ganhar tempo na rotina.</p>
          <a href="#implantacao">VEJA COMO É COMEÇAR <ArrowDownRight size={17} aria-hidden="true" /></a>
        </div>
      </div>

      <div className="koma-benefits-grid">
        {BENEFITS.map((benefit) => {
          const Icon = benefit.icon;

          return (
            <article className={`koma-benefit-card koma-benefit-card--${benefit.tone}`} key={benefit.num}>
              <div className="koma-benefit-card-top">
                <span>{benefit.num} / {benefit.eyebrow}</span>
                <Icon size={23} strokeWidth={1.7} aria-hidden="true" />
              </div>
              <h3>{benefit.title}</h3>
              <p>{benefit.description}</p>
              <ul>
                {benefit.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
              <strong>{benefit.result}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
