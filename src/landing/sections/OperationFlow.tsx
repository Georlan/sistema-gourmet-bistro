import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, CreditCard, Printer, RefreshCw, UsersRound } from 'lucide-react';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const CAPABILITIES = [
  {
    id: 'cardapio',
    num: '01',
    eyebrow: 'CARDÁPIO CENTRALIZADO',
    title: 'MUDE UMA VEZ. ATUALIZE TODAS AS TELAS.',
    description: 'Preço, item e disponibilidade seguem a mesma base no caixa, no app do garçom e no cardápio digital.',
    points: ['CAIXA', 'GARÇOM', 'QR CODE'],
    result: 'UMA ALTERAÇÃO. TODO O RESTAURANTE ATUALIZADO.',
    icon: RefreshCw,
    tone: 'green',
  },
  {
    id: 'pagamento',
    num: '02',
    eyebrow: 'PAGAMENTO FLEXÍVEL',
    title: 'RECEBA DO JEITO QUE A MESA PRECISA.',
    description: 'Registre pagamentos parciais, valores exatos e acompanhe quanto ainda falta receber.',
    points: ['PARCIAL', 'VALOR EXATO', 'SALDO VISÍVEL'],
    result: 'MENOS CONTA REFEITA NO CAIXA.',
    icon: CreditCard,
    tone: 'dark',
  },
  {
    id: 'impressao',
    num: '03',
    eyebrow: 'IMPRESSÃO AUTOMÁTICA',
    title: 'A COMANDA CERTA SAI NO LUGAR CERTO.',
    description: 'Produção e fechamento recebem a informação necessária, com observações e histórico para reimpressão.',
    points: ['PRODUÇÃO', 'FECHAMENTO', 'HISTÓRICO'],
    result: 'MAIS CONTROLE. MENOS PAPEL DESPERDIÇADO.',
    icon: Printer,
    tone: 'dark',
  },
  {
    id: 'clientes',
    num: '04',
    eyebrow: 'CLIENTES E RECORRÊNCIA',
    title: 'TRANSFORME PEDIDO EM CLIENTE QUE VOLTA.',
    description: 'Cadastro, histórico, cupons e fidelidade ajudam o restaurante a reconhecer e recuperar seus clientes.',
    points: ['CADASTRO', 'HISTÓRICO', 'FIDELIDADE'],
    result: 'UMA BASE PRONTA PARA VENDER DE NOVO.',
    icon: UsersRound,
    tone: 'light',
  },
] as const;

type CapabilityId = (typeof CAPABILITIES)[number]['id'];

function CapabilityPreview({ id }: { id: CapabilityId }) {
  if (id === 'cardapio') {
    return (
      <div className="koma-capability-preview koma-capability-preview--menu" aria-hidden="true">
        <span>ITEM ATUALIZADO</span>
        <strong>Kôma Smash Bacon</strong>
        <div><b>CAIXA</b><b>GARÇOM</b><b>CARDÁPIO</b></div>
      </div>
    );
  }

  if (id === 'pagamento') {
    return (
      <div className="koma-capability-preview koma-capability-preview--payment" aria-hidden="true">
        <span>TOTAL DA MESA <strong>R$ 126,00</strong></span>
        <div><b>RECEBIDO <em>R$ 80,00</em></b><b>RESTANTE <em>R$ 46,00</em></b></div>
      </div>
    );
  }

  if (id === 'impressao') {
    return (
      <div className="koma-capability-preview koma-capability-preview--print" aria-hidden="true">
        <span><b>COZINHA</b><em>2 ITENS</em><strong>ENVIADO</strong></span>
        <span><b>BALCÃO</b><em>1 BEBIDA</em><strong>ENVIADO</strong></span>
      </div>
    );
  }

  return (
    <div className="koma-capability-preview koma-capability-preview--customer" aria-hidden="true">
      <span>CLIENTE ATIVO</span>
      <strong>MARIA</strong>
      <div><b>8 PEDIDOS</b><b>120 PONTOS</b><b>CUPOM DISPONÍVEL</b></div>
    </div>
  );
}

export function OperationFlow() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <section className="koma-capabilities-section" id="como-funciona" aria-labelledby="capabilities-title">
      <div className="koma-capabilities-heading">
        <div>
          <span>02 / DENTRO DO KÔMA</span>
          <h2 id="capabilities-title">VENDA. RECEBA.<br />PRODUZA. FIDELIZE.</h2>
        </div>

        <div className="koma-capabilities-intro">
          <p>As funções que movimentam o restaurante trabalham juntas, da primeira venda ao próximo pedido.</p>
          <button className="koma-btn koma-btn--primary koma-capabilities-cta" type="button" onClick={() => setLeadModalOpen(true)}>
            COMEÇAR COM O KÔMA
            <ArrowUpRight size={17} strokeWidth={2} aria-hidden="true" />
          </button>
          <small>Cadastro inicial pelo WhatsApp.</small>
        </div>
      </div>

      <div className="koma-capabilities-grid">
        {CAPABILITIES.map((capability, index) => {
          const Icon = capability.icon;

          return (
            <motion.article
              className={`koma-capability-card koma-capability-card--${capability.id} koma-capability-card--${capability.tone}`}
              key={capability.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.24 }}
              transition={{ duration: 0.48, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="koma-capability-card-top">
                <span>{capability.num}</span>
                <div aria-hidden="true"><Icon size={22} strokeWidth={1.7} /></div>
              </div>

              <CapabilityPreview id={capability.id} />

              <div className="koma-capability-card-copy">
                <small>{capability.eyebrow}</small>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
              </div>

              <ul aria-label={`Recursos de ${capability.eyebrow.toLowerCase()}`}>
                {capability.points.map((point) => <li key={point}>{point}</li>)}
              </ul>

              <strong className="koma-capability-result">{capability.result}</strong>
            </motion.article>
          );
        })}
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </section>
  );
}
