import React, { useEffect, useId, useRef, useState } from 'react';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { WhatsAppIcon } from './WhatsAppIcon';

interface LeadCaptureModalProps {
  open: boolean;
  onClose: () => void;
}

interface LeadFormData {
  responsavel: string;
  estabelecimento: string;
  whatsapp: string;
  tipoOperacao: string;
  tamanhoOperacao: string;
}

const INITIAL_FORM: LeadFormData = {
  responsavel: '',
  estabelecimento: '',
  whatsapp: '',
  tipoOperacao: '',
  tamanhoOperacao: '',
};

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function LeadCaptureModal({ open, onClose }: LeadCaptureModalProps) {
  const [form, setForm] = useState<LeadFormData>(INITIAL_FORM);
  const titleId = useId();
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => firstInputRef.current?.focus(), 60);

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const updateField = (field: keyof LeadFormData, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const whatsappUrl = KOMA_LANDING_CONFIG.getLeadWhatsappUrl(form);
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    onClose();
  };

  return (
    <div className="koma-lead-modal" role="presentation">
      <button
        type="button"
        className="koma-lead-modal-backdrop"
        aria-label="Fechar formulário"
        onClick={onClose}
      />

      <section
        className="koma-lead-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="koma-lead-dialog-head">
          <div>
            <span>CADASTRO INICIAL</span>
            <h2 id={titleId}>COMECE COM O KÔMA.</h2>
          </div>
          <button type="button" className="koma-lead-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>

        <p className="koma-lead-intro">
          Conte o essencial sobre seu restaurante. O WhatsApp abrirá com seu cadastro pronto para revisar e enviar.
        </p>

        <form className="koma-lead-form" onSubmit={handleSubmit}>
          <label>
            <span>SEU NOME</span>
            <input
              ref={firstInputRef}
              type="text"
              autoComplete="name"
              value={form.responsavel}
              onChange={(event) => updateField('responsavel', event.target.value)}
              placeholder="Como podemos chamar você?"
              required
              maxLength={80}
            />
          </label>

          <label>
            <span>NOME DO ESTABELECIMENTO</span>
            <input
              type="text"
              autoComplete="organization"
              value={form.estabelecimento}
              onChange={(event) => updateField('estabelecimento', event.target.value)}
              placeholder="Ex.: Restaurante Central"
              required
              maxLength={120}
            />
          </label>

          <label>
            <span>SEU WHATSAPP</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={form.whatsapp}
              onChange={(event) => updateField('whatsapp', formatPhone(event.target.value))}
              placeholder="(88) 99999-9999"
              required
              pattern="\([0-9]{2}\) [0-9]{4,5}-[0-9]{4}"
            />
          </label>

          <div className="koma-lead-form-row">
            <label>
              <span>TIPO DE OPERAÇÃO</span>
              <select
                value={form.tipoOperacao}
                onChange={(event) => updateField('tipoOperacao', event.target.value)}
                required
              >
                <option value="" disabled>Selecione</option>
                <option>Restaurante</option>
                <option>Bar</option>
                <option>Hamburgueria ou lanchonete</option>
                <option>Cafeteria</option>
                <option>Delivery ou retirada</option>
                <option>Outro</option>
              </select>
            </label>

            <label>
              <span>TAMANHO DA OPERAÇÃO</span>
              <select
                value={form.tamanhoOperacao}
                onChange={(event) => updateField('tamanhoOperacao', event.target.value)}
                required
              >
                <option value="" disabled>Selecione</option>
                <option>Balcão, retirada ou delivery</option>
                <option>Até 10 mesas</option>
                <option>De 11 a 30 mesas</option>
                <option>Mais de 30 mesas</option>
              </select>
            </label>
          </div>

          <button type="submit" className="koma-btn koma-btn--primary koma-lead-submit">
            <WhatsAppIcon />
            ENVIAR CADASTRO PELO WHATSAPP
          </button>
          <small>Você revisa a mensagem antes de enviar. Nenhum dado é enviado automaticamente.</small>
        </form>
      </section>
    </div>
  );
}
