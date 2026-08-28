import React from 'react';
import { ArrowDownRight, Check } from 'lucide-react';
import { SUBSCRIPTION_PLANS } from '../../config/subscriptionPlans';

const ENTRY_PRICE = Math.min(...SUBSCRIPTION_PLANS.map((plan) => plan.price));

const PRODUCT_PROOFS = [
  {
    value: '16',
    label: 'CAPACIDADES DISPONÍVEIS',
    detail: 'Funcionalidades que já podem ser demonstradas, do pedido ao relacionamento.',
  },
  {
    value: `R$ ${ENTRY_PRICE}`,
    label: 'PLANO DE ENTRADA',
    detail: 'Preço mensal público para começar com o essencial da operação.',
  },
  {
    value: 'WEB',
    label: 'ACESSO PELO NAVEGADOR',
    detail: 'A operação abre sem depender de um equipamento exclusivo.',
  },
];

const AVAILABLE_AREAS = [
  'PDV, mesas e comandas',
  'KDS e impressão',
  'Cardápio e pedidos online',
  'Delivery e motoboy',
  'Estoque, financeiro e relatórios',
  'CRM, fidelidade e cupons',
];

export function SocialProof() {
  return (
    <section className="koma-proof-section koma-trust-section" id="credibilidade" aria-labelledby="proof-title">
      <div className="koma-trust-shell">
        <header className="koma-trust-heading">
          <div>
            <span>02 / CONFIANÇA</span>
            <h2 id="proof-title">PRODUTO REAL.<br /><strong>PROVA VISÍVEL.</strong></h2>
          </div>
          <div className="koma-trust-intro">
            <p>
              O Kôma conecta venda, operação e gestão no mesmo sistema.
              Você confere telas, fluxos e preço antes de decidir.
            </p>
            <a href="#como-funciona">
              EXPLORAR O PRODUTO <ArrowDownRight aria-hidden="true" />
            </a>
          </div>
        </header>

        <div className="koma-trust-ledger">
          <div className="koma-trust-stats" role="list" aria-label="Evidências do produto Kôma">
            {PRODUCT_PROOFS.map((proof, index) => (
              <article key={proof.label} role="listitem">
                <span>0{index + 1}</span>
                <strong>{proof.value}</strong>
                <h3>{proof.label}</h3>
                <p>{proof.detail}</p>
              </article>
            ))}
          </div>

          <article className="koma-trust-product-card">
            <div className="koma-trust-product-head">
              <span><i aria-hidden="true" /> DISPONÍVEL HOJE</span>
              <small>TELAS E FLUXOS DEMONSTRÁVEIS</small>
            </div>

            <div className="koma-trust-product-copy">
              <p>O QUE JÁ PODE SER VISTO FUNCIONANDO</p>
              <h3>DO PEDIDO<br />AO FECHAMENTO.</h3>
            </div>

            <ul>
              {AVAILABLE_AREAS.map((area) => (
                <li key={area}><Check aria-hidden="true" /> {area}</li>
              ))}
            </ul>

            <div className="koma-trust-product-foot">
              <span>SÓ COMUNICAMOS O QUE JÁ PODE SER DEMONSTRADO.</span>
              <b aria-hidden="true">KÔMA / 2026</b>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
