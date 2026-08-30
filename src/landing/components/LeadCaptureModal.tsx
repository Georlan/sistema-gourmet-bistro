import React, { useEffect, useId, useRef, useState } from 'react';
import { KOMA_LANDING_CONFIG, type LeadFormData, type LeadSelection } from '../config/landingConfig';
import { WhatsAppIcon } from './WhatsAppIcon';

interface LeadCaptureModalProps {
  open: boolean;
  onClose: () => void;
  selection?: LeadSelection;
}

export function LeadCaptureModal({ open, onClose, selection }: LeadCaptureModalProps) {
  const [form, setForm] = useState<LeadFormData>({ responsavel: '', estabelecimento: '' });
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const trigger = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    setCopyStatus('idle');
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

  const handleCopy = async () => {
    if (!formRef.current?.reportValidity()) return;
    try {
      await navigator.clipboard.writeText(KOMA_LANDING_CONFIG.getLeadMessage(form, selection));
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
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
      <p id={descriptionId} className="koma-lead-intro">Só precisamos de duas informações para começar a conversa.</p>
      {selection && <p className="koma-lead-selection">Seu interesse: <strong>{selection.plan}</strong> · {selection.billing}. Isso não é uma contratação.</p>}
      <form ref={formRef} className="koma-lead-form" onSubmit={event => {
        event.preventDefault();
        window.open(KOMA_LANDING_CONFIG.getLeadWhatsappUrl(form, selection), '_blank', 'noopener,noreferrer');
        onClose();
      }}>
        <label><span>SEU NOME</span><input type="text" name="name" autoComplete="name" required maxLength={80}
          placeholder="Como podemos chamar você?" value={form.responsavel} pattern=".*\S.*"
          onChange={event => { setCopyStatus('idle'); setForm({ ...form, responsavel: event.target.value }); }} /></label>
        <label><span>NOME DO ESTABELECIMENTO</span><input type="text" name="organization" autoComplete="organization" required maxLength={120}
          placeholder="Ex.: Restaurante Central" value={form.estabelecimento} pattern=".*\S.*"
          onChange={event => { setCopyStatus('idle'); setForm({ ...form, estabelecimento: event.target.value }); }} /></label>
        <button type="submit" className="koma-btn koma-btn--primary koma-lead-submit"><WhatsAppIcon /> PEDIR DEMO NO WHATSAPP</button>
        <small>Você revisa e envia a mensagem no WhatsApp. Nenhum dado é enviado automaticamente.</small>
        <button type="button" className="koma-copy-message" onClick={handleCopy}>Copiar mensagem</button>
        <small role="status">{copyStatus === 'copied' ? 'Mensagem copiada.' : copyStatus === 'error' ? 'Não foi possível copiar. Use o botão do WhatsApp.' : ''}</small>
      </form>
    </dialog>
  );
}
