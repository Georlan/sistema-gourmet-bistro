import React from 'react';
import { ArrowDownRight, Clock3, RotateCcw, WalletCards } from 'lucide-react';

const BENEFITS = [
  {
    num: '01',
    eyebrow: 'MAIS CONTROLE',
    title: 'SAIBA ONDE O DINHEIRO VAI.',
    description: 'Caixa e histórico começam no Pocket. Estoque, financeiro e relatórios completos entram no Pro e Premium.',
    items: ['CAIXA E HISTÓRICO — TODOS OS PLANOS', 'ESTOQUE E FINANCEIRO — PRO E PREMIUM', 'RELATÓRIOS COMPLETOS — PRO E PREMIUM'],
    result: 'DECIDA COM NÚMEROS, NÃO COM ACHISMO.',
    icon: WalletCards,
    tone: 'dark',
  },
  {
    num: '02',
    eyebrow: 'MAIS RETORNO',
    title: 'DÊ MOTIVOS PARA O CLIENTE VOLTAR.',
    description: 'Histórico de clientes faz parte da base. Pontos, cashback e cupons são recursos do Premium.',
    items: ['HISTÓRICO DO CLIENTE — TODOS OS PLANOS', 'PONTOS E CASHBACK — PREMIUM', 'CUPONS — PREMIUM'],
    result: 'A VENDA TERMINA. O RELACIONAMENTO CONTINUA.',
    icon: RotateCcw,
    tone: 'light',
  },
  {
    num: '03',
    eyebrow: 'MAIS TEMPO',
    title: 'DEIXE O SISTEMA FAZER O REPETITIVO.',
    description: 'Equipe com permissões e delivery estão na base. Impressão automática e KDS entram no Pro e Premium; app do entregador é Premium.',
    items: ['EQUIPE E DELIVERY — TODOS OS PLANOS', 'IMPRESSÃO E KDS — PRO E PREMIUM', 'APP DO ENTREGADOR — PREMIUM'],
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
          <p>O Kôma vai além do pedido com recursos de controle e relacionamento que crescem conforme o plano escolhido.</p>
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
