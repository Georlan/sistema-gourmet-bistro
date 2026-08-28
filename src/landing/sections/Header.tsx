import React, { useEffect, useState } from 'react';
import { KOMA_WORDMARK_ON_DARK_SRC } from '../../brand/komaBrand';
import { WhatsAppIcon } from '../components/WhatsAppIcon';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

export function Header({ onOpenLead }: { onOpenLead: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const startDemo = () => {
    setMenuOpen(false);
    onOpenLead();
  };

  return (
    <>
      <header className={`koma-header ${scrolled ? 'is-scrolled' : ''}`} role="banner">
        <a href="/landing" className="koma-header-logo" aria-label="Kôma, início">
          <img src={KOMA_WORDMARK_ON_DARK_SRC} alt="Kôma" />
        </a>

        <nav className="koma-header-nav" aria-label="Navegação principal">
          <a href="#produto">Produto</a>
          <a href="#implantacao">Implantação</a>
          <a href="#planos">Planos</a>
          <a href="#duvidas">Dúvidas</a>
        </nav>

        <div className="koma-header-actions">
          <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer" className="koma-header-whatsapp">
            <WhatsAppIcon />
            WhatsApp
          </a>
          <button type="button" className="koma-btn koma-btn--primary koma-btn--sm" onClick={onOpenLead}>
            Ver demonstração
          </button>
        </div>

        <button
          type="button"
          className={`koma-menu-toggle ${menuOpen ? 'is-open' : ''}`}
          onClick={() => setMenuOpen((open) => !open)}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
        >
          <span /><span />
        </button>
      </header>

      <div className={`koma-mobile-menu ${menuOpen ? 'is-open' : ''}`} aria-hidden={!menuOpen}>
        <nav aria-label="Menu mobile">
          <a href="#produto" onClick={() => setMenuOpen(false)}>Produto</a>
          <a href="#implantacao" onClick={() => setMenuOpen(false)}>Implantação</a>
          <a href="#planos" onClick={() => setMenuOpen(false)}>Planos</a>
          <a href="#duvidas" onClick={() => setMenuOpen(false)}>Dúvidas</a>
          <button type="button" className="koma-btn koma-btn--primary" onClick={startDemo}>Agendar demonstração</button>
          <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer" className="koma-mobile-menu-whatsapp">
            <WhatsAppIcon /> Falar no WhatsApp
          </a>
        </nav>
      </div>
    </>
  );
}
