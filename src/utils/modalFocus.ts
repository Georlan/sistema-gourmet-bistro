/** Manage one body-level modal portal without changing its presentation/state.
 * Background inert values and focus are restored even under React StrictMode.
 */
export function containModalFocus(dialog: HTMLElement, onClose: () => void, initialFocus: HTMLElement = dialog) {
  const doc = dialog.ownerDocument;
  const opener = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const background = Array.from(doc.body.children)
    .filter((node): node is HTMLElement => node instanceof HTMLElement && !node.contains(dialog));
  const previousInert = background.map(node => [node, node.inert] as const);
  previousInert.forEach(([node]) => { node.inert = true; });

  const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'button, a[href], input, select, textarea, [tabindex]',
  )).filter(node => node.tabIndex >= 0 && !node.matches(':disabled')
    && !node.closest('[inert], [hidden], [aria-hidden="true"]') && node.getClientRects().length > 0);
  const focusInitial = () => initialFocus.focus({ preventScroll: true });
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = focusable();
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
    } else if (!dialog.contains(doc.activeElement) || (!event.shiftKey && doc.activeElement === last)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    } else if (event.shiftKey && (doc.activeElement === first || doc.activeElement === dialog)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    }
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node)) focusInitial();
  };
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('focusin', onFocusIn);
  focusInitial();
  return () => {
    doc.removeEventListener('keydown', onKeyDown, true);
    doc.removeEventListener('focusin', onFocusIn);
    previousInert.forEach(([node, inert]) => { node.inert = inert; });
    if (opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
  };
}
