import React, { useEffect, useRef, useState } from 'react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../../brand/komaBrand';

export function Header() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return <header className="v2-header">
    <div className="v2-header-inner">
      <a className="v2-logo" href="/" aria-label="KÔMA, início"><img src={KOMA_WORDMARK_ON_DARK_SRC} alt="KÔMA" /></a>
      <nav className="v2-nav" aria-label="Navegação principal"><a href="#como-funciona">Produto</a><a href="#planos">Planos</a></nav>
      <a className="v2-button v2-button--small" href="#planos">Ver planos</a>
      <button ref={toggle} className="v2-menu-toggle" type="button" aria-expanded={open} aria-controls="v2-mobile-nav" aria-label={open ? 'Fechar menu' : 'Abrir menu'} onClick={() => setOpen(!open)}><span /><span /><span /></button>
    </div>
    <nav id="v2-mobile-nav" className="v2-mobile-nav" aria-label="Menu mobile" hidden={!open}>
      <a href="#como-funciona" onClick={() => setOpen(false)}>Produto</a><a href="#planos" onClick={() => setOpen(false)}>Planos</a>
    </nav>
  </header>;
}
