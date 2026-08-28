import React from 'react';
import {
  ArrowDownRight,
  Boxes,
  ChartNoAxesCombined,
  Printer,
  ShieldCheck,
  Truck,
  UsersRound,
} from 'lucide-react';

const CAPABILITIES = [
  {
    num: '01',
    label: 'ESTOQUE',
    title: 'SAIBA O QUE SAI E O QUE PRECISA REPOR.',
    description: 'Insumos e movimentações acompanham a rotina para a compra deixar de ser um palpite.',
    features: ['Fichas e insumos', 'Entradas e perdas', 'Contagem e fornecedores'],
    result: 'ESTOQUE LIGADO AO QUE FOI VENDIDO.',
    signal: 'MOVIMENTAÇÃO',
    value: 'ATUALIZADA',
    icon: Boxes,
    tone: 'dark',
  },
  {
    num: '02',
    label: 'FINANCEIRO',
    title: 'FECHE O CAIXA COM CONTEXTO.',
    description: 'Vendas, movimentações e fechamentos ficam organizados para você entender o resultado do turno.',
    features: ['Abertura e fechamento', 'Entradas e saídas', 'Relatórios financeiros'],
    result: 'MENOS CONFERÊNCIA SOLTA. MAIS VISÃO DO CAIXA.',
    signal: 'TURNO',
    value: 'CONCILIADO',
    icon: ChartNoAxesCombined,
    tone: 'green',
  },
  {
    num: '03',
    label: 'CLIENTES',
    title: 'FAÇA O CLIENTE TER MOTIVO PARA VOLTAR.',
    description: 'Histórico, fidelidade e cupons ajudam a reconhecer quem compra e criar novas visitas.',
    features: ['CRM e histórico', 'Fidelidade', 'Cupons'],
    result: 'RELACIONAMENTO DEPOIS DO PAGAMENTO.',
    signal: 'CLIENTE',
    value: 'RECONHECIDO',
    icon: UsersRound,
    tone: 'light',
  },
  {
    num: '04',
    label: 'DELIVERY',
    title: 'ACOMPANHE ATÉ A ENTREGA.',
    description: 'Retirada, entrega e motoboy continuam ligados ao pedido desde a produção até a saída.',
    features: ['Retirada e delivery', 'Gestão de motoboy', 'Status do pedido'],
    result: 'A ENTREGA NÃO SOME DEPOIS DA COZINHA.',
    signal: 'ENTREGA',
    value: 'EM ROTA',
    icon: Truck,
    tone: 'light',
  },
  {
    num: '05',
    label: 'EQUIPE',
    title: 'CADA PESSOA VÊ O QUE PRECISA.',
    description: 'Acessos e responsabilidades deixam a rotina mais segura sem complicar o trabalho da equipe.',
    features: ['Cargos e acessos', 'Permissões', 'Histórico de ações'],
    result: 'MAIS AUTONOMIA, COM CONTROLE.',
    signal: 'ACESSO',
    value: 'PROTEGIDO',
    icon: ShieldCheck,
    tone: 'dark',
  },
  {
    num: '06',
    label: 'AUTOMAÇÃO',
    title: 'A OPERAÇÃO AVISA E IMPRIME SOZINHA.',
    description: 'KDS, impressão e mensagens transacionais reduzem tarefas repetidas nos momentos de maior movimento.',
    features: ['KDS', 'Impressão automática', 'WhatsApp transacional'],
    result: 'A PRÓXIMA AÇÃO CHEGA A QUEM PRECISA.',
    signal: 'ROTINA',
    value: 'AUTOMATIZADA',
    icon: Printer,
    tone: 'green',
  },
] as const;

export function Capabilities() {
  return (
    <section className="koma-capabilities-section" id="recursos" aria-labelledby="capabilities-title">
      <div className="koma-capabilities-heading">
        <div>
          <span>05 / ALÉM DO PDV</span>
          <h2 id="capabilities-title">O QUE JÁ EXISTE. E QUASE NINGUÉM VÊ.</h2>
        </div>
        <div className="koma-capabilities-intro">
          <p>O essencial aparece primeiro. Quando a operação cresce, estoque, financeiro, clientes, entrega e equipe continuam no mesmo sistema.</p>
          <a className="koma-capabilities-cta koma-btn koma-btn--outline" href="#planos">
            VER EM QUAL PLANO ENTRA <ArrowDownRight size={17} aria-hidden="true" />
          </a>
          <small>Sem prometer o que ainda não está pronto.</small>
        </div>
      </div>

      <div className="koma-capabilities-grid">
        {CAPABILITIES.map((capability) => {
          const Icon = capability.icon;

          return (
            <article className={`koma-capability-card koma-capability-card--third koma-capability-card--${capability.tone}`} key={capability.num}>
              <div className="koma-capability-card-top">
                <span>{capability.num} / {capability.label}</span>
                <div aria-hidden="true"><Icon size={21} strokeWidth={1.7} /></div>
              </div>

              <div className="koma-capability-preview koma-capability-preview--signal" aria-hidden="true">
                <span><small>STATUS DA OPERAÇÃO</small><i /></span>
                <div><b>{capability.signal}</b><strong>{capability.value}</strong></div>
              </div>

              <div className="koma-capability-card-copy">
                <small>{capability.label}</small>
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
              </div>

              <ul>
                {capability.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <strong className="koma-capability-result">{capability.result}</strong>
            </article>
          );
        })}
      </div>
    </section>
  );
}
