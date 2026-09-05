import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink } from 'lucide-react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../brand/komaBrand';
import { SUBSCRIPTION_PLANS, formatCurrency, formatPercentage } from '../config/subscriptionPlans';
import { LEGAL_VERSION } from './legalContent';
import './legal.css';

type ContractForm = {
  responsibleName: string;
  email: string;
  phone: string;
  restaurantName: string;
};

const EMPTY_FORM: ContractForm = {
  responsibleName: '',
  email: '',
  phone: '',
  restaurantName: '',
};

export default function PocketContractPage() {
  const pocket = useMemo(() => SUBSCRIPTION_PLANS.find((plan) => plan.id === 'pocket'), []);
  const [form, setForm] = useState<ContractForm>(EMPTY_FORM);
  const [accepted, setAccepted] = useState(false);
  const [previewComplete, setPreviewComplete] = useState(false);

  useEffect(() => {
    document.title = 'Contratar KÔMA Pocket | KÔMA';
    window.scrollTo(0, 0);
  }, []);

  if (!pocket) return null;

  const canContinue = accepted && Object.values(form).every((value) => value.trim().length > 0);

  const updateField = (field: keyof ContractForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setPreviewComplete(false);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue) return;
    // Nesta PR a tela é de contratação/UX. O próximo passo conecta este evento
    // ao registro imutável de aceite + provisionamento seguro no backend.
    setPreviewComplete(true);
  };

  return (
    <div className="koma-legal-shell">
      <header className="koma-legal-header">
        <a href="/landing" className="koma-legal-brand" aria-label="Voltar para o KÔMA">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" />
        </a>
        <nav aria-label="Navegação da contratação">
          <a href="/landing#planos">Ver planos</a>
          <a href="/legal">Legal e privacidade</a>
        </nav>
      </header>

      <main className="koma-contract-main">
        <div className="koma-contract-topline">
          <a href="/landing#planos"><ArrowLeft size={14} aria-hidden="true" /> Voltar aos planos</a>
          <span>Contratação online / Pocket</span>
        </div>

        <section className="koma-contract-hero">
          <div>
            <span className="koma-legal-kicker">COMECE LEVE</span>
            <h1>KÔMA<br /><em>POCKET.</em></h1>
            <p>
              Revise o plano, informe os dados do responsável e consulte os documentos que
              regerão a contratação. Nada fica escondido no fim do processo.
            </p>
          </div>
          <aside className="koma-contract-price" aria-label={`${formatCurrency(pocket.price)} por mês e ${formatPercentage(pocket.splitFeeRate)} nos pedidos online pagos`}>
            <span>PLANO MENSAL</span>
            <strong>{formatCurrency(pocket.price)}</strong>
            <small>por mês + {formatPercentage(pocket.splitFeeRate)} nos pedidos online pagos elegíveis</small>
          </aside>
        </section>

        <form className="koma-contract-grid" onSubmit={handleSubmit}>
          <section className="koma-contract-panel" aria-labelledby="contract-data-title">
            <h2 id="contract-data-title">Dados para a contratação</h2>
            <p>Esses dados identificarão o responsável e o restaurante no aceite eletrônico.</p>

            <div className="koma-contract-fields">
              <div className="koma-contract-field">
                <label htmlFor="responsible-name">Nome do responsável</label>
                <input
                  id="responsible-name"
                  name="responsibleName"
                  autoComplete="name"
                  value={form.responsibleName}
                  onChange={(event) => updateField('responsibleName', event.target.value)}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="restaurant-name">Nome do restaurante</label>
                <input
                  id="restaurant-name"
                  name="restaurantName"
                  autoComplete="organization"
                  value={form.restaurantName}
                  onChange={(event) => updateField('restaurantName', event.target.value)}
                  placeholder="Nome do estabelecimento"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-email">E-mail</label>
                <input
                  id="contract-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  placeholder="voce@restaurante.com"
                  required
                />
              </div>
              <div className="koma-contract-field">
                <label htmlFor="contract-phone">Telefone / WhatsApp</label>
                <input
                  id="contract-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  value={form.phone}
                  onChange={(event) => updateField('phone', event.target.value)}
                  placeholder="(00) 00000-0000"
                  required
                />
              </div>
            </div>

            <div className="koma-contract-acceptance">
              <input
                id="legal-acceptance"
                type="checkbox"
                checked={accepted}
                onChange={(event) => {
                  setAccepted(event.target.checked);
                  setPreviewComplete(false);
                }}
              />
              <label htmlFor="legal-acceptance">
                Li e aceito os <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação</a>,
                {' '}as <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais</a> e o
                {' '}<a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Tratamento de Dados</a>,
                todos na versão {LEGAL_VERSION}. Declaro também estar ciente da
                {' '}<a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.
              </label>
            </div>

            <button type="submit" className="koma-contract-action" disabled={!canContinue}>
              Revisar contratação <ArrowRight size={17} aria-hidden="true" />
            </button>
            <p className="koma-contract-note">
              Esta primeira entrega cria a interface e a versão legal. O registro imutável do aceite e o
              provisionamento automático serão conectados ao backend antes de este fluxo ser liberado em produção.
            </p>

            {previewComplete && (
              <div className="koma-contract-status" role="status">
                <CheckCircle2 size={18} aria-hidden="true" />
                <strong> Interface validada.</strong> Os dados, o plano e a versão jurídica estão prontos para serem enviados ao endpoint de contratação na próxima etapa.
              </div>
            )}
          </section>

          <aside className="koma-contract-panel koma-contract-summary" aria-labelledby="contract-summary-title">
            <div>
              <span className="koma-legal-kicker">RESUMO</span>
              <h2 id="contract-summary-title">Sua contratação</h2>
            </div>
            <dl>
              <div><dt>Plano</dt><dd>Pocket</dd></div>
              <div><dt>Mensalidade</dt><dd>{formatCurrency(pocket.price)}/mês</dd></div>
              <div><dt>Taxa KÔMA online</dt><dd>{formatPercentage(pocket.splitFeeRate)}</dd></div>
              <div><dt>Implantação</dt><dd>R$ 0</dd></div>
              <div><dt>Pagamento online</dt><dd>via conta do restaurante</dd></div>
            </dl>

            <div className="koma-contract-legal-list" aria-label="Documentos da contratação">
              <a href="/legal/termos" target="_blank" rel="noreferrer">Termos de Contratação <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/planos" target="_blank" rel="noreferrer">Condições Comerciais <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/dpa" target="_blank" rel="noreferrer">Anexo de Dados (DPA) <ExternalLink size={15} aria-hidden="true" /></a>
              <a href="/legal/privacidade" target="_blank" rel="noreferrer">Política de Privacidade <ExternalLink size={15} aria-hidden="true" /></a>
            </div>

            <p className="koma-contract-note">
              Custos cobrados pelo provedor de pagamento são separados da taxa KÔMA e seguem as condições do próprio provedor.
            </p>
          </aside>
        </form>
      </main>

      <footer className="koma-legal-footer">
        <span>© {new Date().getFullYear()} KÔMA</span>
        <nav aria-label="Links legais da contratação">
          <a href="/legal">Central legal</a>
          <a href="/legal/privacidade">Privacidade</a>
        </nav>
      </footer>
    </div>
  );
}
