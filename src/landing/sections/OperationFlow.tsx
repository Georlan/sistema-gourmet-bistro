import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, ChefHat, CreditCard, RefreshCw } from 'lucide-react';
import { LeadCaptureModal } from '../components/LeadCaptureModal';

const CAPABILITIES = [
  {
    id: 'producao',
    num: '01',
    eyebrow: 'PRODUÇÃO ORGANIZADA',
    title: 'A COZINHA RECEBE SEM NOVO REPASSE.',
    description: 'Itens, quantidades e observações seguem do pedido para a fila de produção e para a impressão configurada.',
    points: ['KDS', 'OBSERVAÇÕES', 'IMPRESSÃO'],
    result: 'O PEDIDO CHEGA CLARO PARA QUEM VAI PRODUZIR.',
    icon: ChefHat,
    tone: 'green',
  },
  {
    id: 'controle',
    num: '02',
    eyebrow: 'CONTROLE CENTRAL',
    title: 'MUDE UMA VEZ. ATUALIZE A OPERAÇÃO.',
    description: 'Preço, item e disponibilidade seguem a mesma base no caixa, no app do garçom e no cardápio digital.',
    points: ['PRODUTOS', 'DISPONIBILIDADE', 'RELATÓRIOS'],
    result: 'MENOS CADASTRO REPETIDO. MAIS CONTEXTO PARA DECIDIR.',
    icon: RefreshCw,
    tone: 'light',
  },
  {
    id: 'pagamento',
    num: '03',
    eyebrow: 'PAGAMENTO FLEXÍVEL',
    title: 'RECEBA DO JEITO QUE A MESA PRECISA.',
    description: 'Registre pagamentos parciais, valores exatos e acompanhe quanto ainda falta receber.',
    points: ['PARCIAL', 'VALOR EXATO', 'SALDO VISÍVEL'],
    result: 'MENOS CONTA REFEITA NO CAIXA.',
    icon: CreditCard,
    tone: 'dark',
  },
] as const;

type CapabilityId = (typeof CAPABILITIES)[number]['id'];

function CapabilityPreview({ id }: { id: CapabilityId }) {
  if (id === 'controle') {
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

  if (id === 'producao') {
    return (
      <div className="koma-capability-preview koma-capability-preview--print" aria-hidden="true">
        <span><b>COZINHA</b><em>2 ITENS</em><strong>ENVIADO</strong></span>
        <span><b>BALCÃO</b><em>1 BEBIDA</em><strong>ENVIADO</strong></span>
      </div>
    );
  }

  return null;
}

export function OperationFlow() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <section className="koma-capabilities-section" id="modulos" aria-labelledby="capabilities-title">
      <div className="koma-capabilities-heading">
        <div>
          <span>04 / MÓDULOS QUE EVITAM RETRABALHO</span>
          <h2 id="capabilities-title">PRODUZA. CONTROLE.<br />RECEBA.</h2>
        </div>

        <div className="koma-capabilities-intro">
          <p>Três partes críticas da rotina compartilham o mesmo pedido, sem repetir cadastro ou conferência.</p>
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
