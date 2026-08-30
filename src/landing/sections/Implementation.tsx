import React from 'react';
import { useLeadCapture } from '../components/LeadCaptureProvider';
import { ArrowDownRight, Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';

const STEPS = [
  {
    num: '01',
    title: 'ENTENDEMOS SUA ROTINA',
    text: 'Você mostra como trabalha e nós indicamos o melhor jeito de usar o Kôma.',
  },
  {
    num: '02',
    title: 'CONFIGURAMOS COM VOCÊ',
    text: 'Cardápio, equipe, impressão e equipamentos são conferidos antes da estreia.',
  },
  {
    num: '03',
    title: 'ACOMPANHAMOS O INÍCIO',
    text: 'Sua equipe recebe orientação para começar com segurança e sem comprar no escuro.',
  },
] as const;

export function Implementation() {
  const openDemo = useLeadCapture();
  return (
    <section className="koma-implementation-section" id="implantacao" aria-labelledby="implementation-title">
      <div className="koma-implementation-main">
        <div className="koma-implementation-copy">
          <span>04 / COMEÇAR É SIMPLES</span>
          <h2 id="implementation-title">COM VOCÊ.<br />DESDE O INÍCIO.</h2>
          <p>Da configuração ao primeiro pedido, sua equipe recebe orientação.</p>
          <button type="button" className="koma-btn koma-btn--primary" onClick={() => openDemo()}>
            SOLICITAR DEMONSTRAÇÃO <ArrowDownRight size={17} aria-hidden="true" />
          </button>
        </div>

        <ol className="koma-implementation-steps">
          {STEPS.map((step) => (
            <li key={step.num}>
              <span>{step.num}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="koma-compatibility-strip">
        <div>
          <Smartphone aria-hidden="true" />
          <Tablet aria-hidden="true" />
          <Laptop aria-hidden="true" />
          <Monitor aria-hidden="true" />
        </div>
        <strong>USE CELULAR, TABLET OU COMPUTADOR.</strong>
        <p>O Kôma funciona pelo navegador. Impressoras e periféricos são conferidos antes da contratação.</p>
      </div>
    </section>
  );
}
