import React, { useState } from 'react';
import {
  ArrowUpRight,
  ChefHat,
  CircleDollarSign,
  LayoutGrid,
  Printer,
  QrCode,
  RefreshCw,
  Store,
} from 'lucide-react';
import { KOMA_WORDMARK_ON_LIGHT_SRC } from '../../brand/komaBrand';
import { LeadCaptureModal } from '../components/LeadCaptureModal';
import { formatPlanScopeText, getFeatureAvailability } from '../landingContractAdapter';

const CHANNELS = ['Retirada', 'Delivery', 'Garçom', 'Cardápio digital'];

export function Ecosystem() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);

  return (
    <>
      <section className="koma-ecosystem-section" aria-labelledby="ecosystem-title">
        <div className="koma-eco-heading">
          <div>
            <span className="koma-eco-tag">04 / O KÔMA NA PRÁTICA</span>
            <h2 id="ecosystem-title" className="koma-eco-title">
              VENDA, SALÃO, PREPARO E CAIXA.<br />
              <em>UM FLUXO CONECTADO.</em>
            </h2>
          </div>

          <div className="koma-eco-intro">
            <p>
              Os canais atendidos pelo Kôma alimentam a mesma operação com gestão de equipe na base. Recursos avançados de cozinha, estoque e automação variam conforme o plano.
            </p>
            <button type="button" onClick={() => setLeadModalOpen(true)}>
              Quero começar com o Kôma
              <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="koma-eco-bento">
          <article className="koma-eco-card koma-eco-card--channels">
            <div className="koma-eco-card-topline">
              <span>01 / VENDA MULTICANAL</span>
              <Store aria-hidden="true" />
            </div>
            <div className="koma-eco-channel-flow" aria-hidden="true">
              <div className="koma-eco-channel-source">
                {CHANNELS.map((channel) => <span key={channel}>{channel}</span>)}
              </div>
              <div className="koma-eco-channel-core">
                <small>ENTRA NO</small>
                <img
                  src={KOMA_WORDMARK_ON_LIGHT_SRC}
                  alt="Kôma"
                  style={{ width: 'clamp(88px, 8vw, 124px)', height: 'auto', objectFit: 'contain' }}
                />
                <i />
              </div>
            </div>
            <div className="koma-eco-card-copy">
              <h3>REÚNA OS CANAIS QUE O KÔMA ATENDE.</h3>
              <p>Retirada, delivery, garçom e cardápio digital entram na mesma operação para atendimento, preparo e caixa acompanharem.</p>
            </div>
            <strong className="koma-eco-result">MAIS FORMAS DE VENDER. MENOS INFORMAÇÃO ESPALHADA.</strong>
          </article>

          <article className="koma-eco-card koma-eco-card--tables">
            <div className="koma-eco-card-topline">
              <span>02 / SALÃO</span>
              <LayoutGrid aria-hidden="true" />
            </div>
            <div className="koma-eco-table-preview" aria-label="Exemplo de status das mesas">
              <div className="koma-eco-table-preview-head">
                <strong>MESAS</strong>
                <span>AO VIVO</span>
              </div>
              <div className="koma-eco-table-grid">
                <span className="is-free"><b>Mesa 01</b><small>Livre</small></span>
                <span className="is-busy"><b>Mesa 04</b><small>Em atendimento</small></span>
                <span className="is-alert"><b>Mesa 12</b><small>Ver agora</small></span>
                <span className="is-ready"><b>Mesa 08</b><small>Pronta para fechar</small></span>
              </div>
            </div>
            <div className="koma-eco-card-copy">
              <h3>SAIBA O QUE ACONTECE EM CADA MESA.</h3>
              <p>Status e consumo ficam visíveis para a equipe acompanhar o atendimento com menos conferência manual.</p>
            </div>
            <strong className="koma-eco-result">ATENDIMENTO MAIS CLARO. MENOS CONFERÊNCIA.</strong>
          </article>

          <article className="koma-eco-card koma-eco-card--kitchen">
            <div className="koma-eco-card-topline">
              <span>03 / PRODUÇÃO</span>
              <ChefHat aria-hidden="true" />
            </div>
            <div className="koma-eco-kds-preview" aria-label="Exemplo de fila da cozinha">
              <div>
                <small>EM PREPARO</small>
                <strong>Kôma Smash Bacon</strong>
                <span>08 min</span>
              </div>
              <div className="is-priority">
                <small>ATENÇÃO</small>
                <strong>Filé de frango</strong>
                <span>16 min</span>
              </div>
              <div>
                <small>PRÓXIMO</small>
                <strong>Batata rústica</strong>
                <span>02 min</span>
              </div>
            </div>
            <div className="koma-eco-card-copy">
              <h3>ORGANIZE O PREPARO.</h3>
              <p>A fila de preparo existe em todos os planos. KDS e impressão automática ficam disponíveis no {formatPlanScopeText(getFeatureAvailability('printing'))}.</p>
            </div>
            <strong className="koma-eco-result">PRIORIDADE VISÍVEL. PREPARO ORGANIZADO.</strong>
          </article>

          <article className="koma-eco-card koma-eco-card--sync">
            <div className="koma-eco-card-topline">
              <span>04 / CONTROLE CENTRAL</span>
              <RefreshCw aria-hidden="true" />
            </div>
            <div className="koma-eco-sync-preview" aria-hidden="true">
              <div className="koma-eco-sync-item">
                <span>ITEM ATUALIZADO</span>
                <strong>Kôma Smash Bacon</strong>
                <small>R$ 32,90 · Disponível</small>
              </div>
              <div className="koma-eco-sync-destinations">
                <span><CircleDollarSign />Caixa</span>
                <span><Store />Garçom</span>
                <span><QrCode />Cardápio</span>
                <span><Printer />Impressão {getFeatureAvailability('printing').pocket ? 'Base' : 'Pro+'}</span>
              </div>
            </div>
            <div className="koma-eco-card-copy">
              <h3>ATUALIZE A BASE DA OPERAÇÃO EM UM SÓ LUGAR.</h3>
              <p>Preço, produto e disponibilidade seguem a mesma base no caixa, no atendimento e no cardápio digital.</p>
            </div>
            <strong className="koma-eco-result">MENOS CADASTRO REPETIDO. MAIS CONSISTÊNCIA.</strong>
          </article>
        </div>

        <div className="koma-eco-conversion">
          <div>
            <span>SEU RESTAURANTE JÁ FUNCIONA.</span>
            <strong>O KÔMA CONECTA AS PARTES CENTRAIS DA OPERAÇÃO.</strong>
          </div>
          <button type="button" onClick={() => setLeadModalOpen(true)}>
            Começar meu cadastro
            <ArrowUpRight aria-hidden="true" />
          </button>
        </div>
      </section>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </>
  );
}
