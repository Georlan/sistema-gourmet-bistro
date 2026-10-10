import React, { useEffect, useId, useRef, useState } from 'react';
import { KOMA_LANDING_CONFIG, type LeadFormData, type LeadSelection } from '../config/landingConfig';
import { API_BASE_URL } from '../../config/api';

interface LeadCaptureModalProps {
  open: boolean;
  onClose: () => void;
  selection?: LeadSelection;
}

export function LeadCaptureModal({ open, onClose, selection }: LeadCaptureModalProps) {
  const [form, setForm] = useState<LeadFormData>({ responsavel: '', estabelecimento: '' });
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [consent, setConsent] = useState(false);
  const submitting = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    setSubmitStatus('idle');
    document.body.style.overflow = 'hidden';
    dialog?.showModal();
    // Don't open a mobile keyboard before the visitor is ready.
    dialog?.querySelector<HTMLElement>('h2')?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      trigger?.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !consent) return;
    submitting.current = true;
    setSubmitStatus('sending');
    try {
      const response = await fetch(`${API_BASE_URL}/api/leads/landing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: form.responsavel, empresa_nome: form.estabelecimento,
          whatsapp: form.whatsapp, consent_whatsapp: consent,
          interesse: selection ? `Demonstração: ${selection.plan} · ${selection.billing}` : 'Demonstração do KÔMA' }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('capture_failed');
      const result = await response.json();
      if (!result.success) throw new Error('capture_failed');
      setSubmitStatus('sent');
    } catch {
      setSubmitStatus('error');
    } finally {
      submitting.current = false;
    }
  };

  return (
    <dialog ref={dialogRef} className="koma-lead-dialog koma-demo-dialog" aria-labelledby={titleId}
      aria-describedby={descriptionId} onCancel={onClose}
      onClick={event => { if (event.target === event.currentTarget) {
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
      } }}>
      <div className="koma-lead-dialog-head">
        <div><span>DEMONSTRAÇÃO SEM COMPROMISSO</span><h2 id={titleId} tabIndex={-1}>CONHEÇA O KÔMA.</h2></div>
        <button type="button" className="koma-lead-close" onClick={onClose} aria-label="Fechar demonstração">×</button>
      </div>
      <p id={descriptionId} className="koma-lead-intro">Deixe seu contato para agendarmos uma demonstração sem compromisso.</p>
      {selection && <p className="koma-lead-selection">Seu interesse: <strong>{selection.plan}</strong> · {selection.billing}. Isso não é uma contratação.</p>}
      {submitStatus === 'sent' ? <div role="status"><p>Pedido de demonstração recebido! Vamos entrar em contato pelo número informado.</p><button type="button" className="koma-btn koma-btn--primary" onClick={onClose}>CONCLUIR</button></div> :
      <form ref={formRef} className="koma-lead-form" onSubmit={handleSubmit}>
        <label><span>SEU NOME</span><input type="text" name="name" autoComplete="name" required maxLength={80}
          placeholder="Como podemos chamar você?" value={form.responsavel} pattern=".*\S.*"
          onChange={event => { setSubmitStatus('idle'); setForm({ ...form, responsavel: event.target.value }); }} /></label>
        <label><span>NOME DO ESTABELECIMENTO</span><input type="text" name="organization" autoComplete="organization" required maxLength={120}
          placeholder="Ex.: Restaurante Central" value={form.estabelecimento} pattern=".*\S.*"
          onChange={event => { setSubmitStatus('idle'); setForm({ ...form, estabelecimento: event.target.value }); }} /></label>
        <label><span>WHATSAPP COM DDD</span><input type="tel" name="tel" autoComplete="tel" required minLength={10} maxLength={30}
          placeholder="(88) 99999-9999" value={form.whatsapp || ''}
          onChange={event => { setSubmitStatus('idle'); setForm({ ...form, whatsapp: event.target.value }); }} /></label>
        <label className="koma-demo-consent"><input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} /> Autorizo o KÔMA a entrar em contato por WhatsApp sobre esta demonstração.</label>
        <button type="submit" disabled={submitStatus === 'sending'} className="koma-btn koma-btn--primary koma-lead-submit">{submitStatus === 'sending' ? 'ENVIANDO…' : 'SOLICITAR DEMONSTRAÇÃO'}</button>
        <small>Este pedido não é uma contratação. O aceite dos termos acontece no cadastro.</small>
        {submitStatus === 'error' && <p role="alert">Não foi possível enviar. Confira o WhatsApp com DDD e tente novamente.</p>}
      </form>}

    </dialog>
  );
}
