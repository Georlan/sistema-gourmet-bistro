import { useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { MessageSquare, X } from 'lucide-react';
import { courierCodeLength, type CourierOrder } from './courierTypes';
import { CourierGlyph } from './CourierGlyph';
import { CourierPayment } from './CourierPayment';

interface Props {
  order: CourierOrder;
  mode: 'items' | 'confirm';
  sourceLogo?: string;
  sourceLabel?: string;
  code: string;
  error: string;
  pending: boolean;
  blocked: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  confirmRef: RefObject<HTMLButtonElement | null>;
  onCode: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Native modal contains focus and restores the initiating action on dismissal. */
export function CourierOrderDialog({ order, mode, sourceLogo, sourceLabel, code, error, pending, blocked, inputRef, confirmRef, onCode, onConfirm, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const startedOutside = useRef(false);
  const titleId = useId();
  const codeId = useId();
  const confirm = mode === 'confirm';
  const codeLength = courierCodeLength(order);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    if (confirm) (inputRef.current || confirmRef.current)?.focus();
    else dialog.querySelector<HTMLButtonElement>('button')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [confirm, inputRef, confirmRef]);
  const count = order.items?.reduce((sum, item) => sum + item.quantity, 0);
  return <dialog ref={ref} className="k-courier__dialog" aria-labelledby={titleId} onPointerDown={event => {
    const bounds = event.currentTarget.getBoundingClientRect();
    startedOutside.current = event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }} onPointerCancel={() => { startedOutside.current = false; }} onClick={event => {
    const outside = startedOutside.current;
    startedOutside.current = false;
    if (!outside || pending || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      event.stopPropagation();
      onClose();
    }
  }} onKeyDown={event => {
    if (event.key !== 'Tab') return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));
    const first = controls[0], last = controls[controls.length - 1];
    if (!first) { event.preventDefault(); return; }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <div className="k-courier__dialog-head"><h2 id={titleId}>{confirm ? 'Confirmar entrega' : `Pedido ${order.numero_pedido ? `#${order.numero_pedido}` : 'sem número'}`}</h2><button type="button" className="k-courier__icon" aria-label="Fechar" disabled={pending} onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
    <div className="k-courier__dialog-body">
      <div className="k-courier__order-person"><span className="k-courier__dialog-art"><CourierGlyph kind={confirm ? 'delivery' : 'items'} /></span><div>{confirm && <strong>Pedido {order.numero_pedido ? `#${order.numero_pedido}` : 'sem número'}</strong>}<span className={confirm ? '' : 'k-courier__customer'}>{order.cliente_nome}</span>{!confirm && count != null && <small>{count} {count === 1 ? 'item' : 'itens'}</small>}</div>{!confirm && sourceLogo && <img className="k-courier__dialog-source" data-channel={order.source?.channel} src={sourceLogo} alt={sourceLabel || 'Origem do pedido'} />}</div>
      {confirm ? <>
        <CourierPayment payment={order.payment} legacyDue={order.valor_a_cobrar} />
        <form className="k-courier__confirm" onSubmit={event => { event.preventDefault(); if (!blocked && !pending) onConfirm(); }}>
          {order.requires_delivery_code ? <div className="k-courier__receipt"><label htmlFor={codeId}>Código de entrega</label><input id={codeId} ref={inputRef} type="text" inputMode="numeric" enterKeyHint="done" autoComplete="one-time-code" pattern={`[0-9]{${codeLength}}`} maxLength={codeLength} placeholder={"–".repeat(codeLength)} value={code} disabled={pending} onChange={event => onCode(event.target.value.replace(/[^0-9]/g, '').slice(0, codeLength))} aria-invalid={Boolean(error)} aria-describedby={`${codeId}-help${error ? ` ${codeId}-error` : ''}`} /><p id={`${codeId}-help`}>Peça os {codeLength} números ao cliente.</p>{error && <p id={`${codeId}-error`} className="k-courier__receipt-error" role="alert">{error}</p>}</div> : <p>Pedido entregue?</p>}
          {blocked && !pending && <p className="k-courier__receipt-status" role="status">Aguarde a conexão e a conferência das entregas.</p>}
          <button type="submit" className="k-courier__action" ref={confirmRef} disabled={blocked || pending || (order.requires_delivery_code && code.length !== codeLength)}><CourierGlyph kind="delivery" />{pending ? 'Confirmando…' : 'Confirmar'}</button>
          <button type="button" className="k-courier__dialog-back" disabled={pending} onClick={onClose}>Cancelar</button>
        </form>
      </> : <>
        {order.items?.length ? <ul className="k-courier__items">{order.items.map((item, index) => <li key={index}><span className="k-courier__quantity" aria-label={`Quantidade ${item.quantity}`}>{item.quantity}<small aria-hidden="true">×</small></span><div><strong>{item.name}</strong>{item.modifiers.length > 0 && <p>{item.modifiers.join(', ')}</p>}{item.notes && <p className="k-courier__item-note"><MessageSquare size={14} aria-hidden="true" /><span>{item.notes}</span></p>}</div></li>)}</ul> : <p className="k-courier__items-fallback">{order.itens_resumo || 'Itens não informados'}</p>}
        <p className="k-courier__order-total"><span>Total do pedido</span><strong>{money.format(order.total)}</strong></p>
        {order.source?.references.map(reference => <p className="k-courier__external-reference" key={`${reference.provider}:${reference.reference}`}>{order.source?.label}: {reference.reference}</p>)}
        <button type="button" className="k-courier__items-action" onClick={onClose}>Voltar às entregas</button>
      </>}
    </div>
  </dialog>;
}
