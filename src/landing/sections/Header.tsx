import React, { useState, useEffect } from 'react';
import logoImg from '../../assets/logo-koma.png';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

export function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuOpen) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  return (
    <>
      <header
        className={`koma-header ${scrolled ? 'koma-header--scrolled' : ''}`}
        role="banner"
      >
        <a href="/landing" className="koma-header-logo" aria-label="KÔMA — Início">
          <img src={logoImg} alt="KÔMA" />
        </a>

        <nav className="koma-header-nav" aria-label="Navegação principal">
          <a href="#produto" className="koma-header-link">Produto</a>
          <a href="#solucoes" className="koma-header-link">Soluções</a>
        </nav>

        <div className="koma-header-actions">
          <a
            href={KOMA_LANDING_CONFIG.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="koma-header-link koma-header-link--whatsapp"
          >
            Falar no WhatsApp ↗
          </a>
          <a href={KOMA_LANDING_CONFIG.demoAnchor} className="koma-btn koma-btn--primary koma-btn--sm">
            Solicitar demonstração
          </a>
        </div>

        <button
          className={`koma-hamburger ${menuOpen ? 'koma-hamburger--open' : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={menuOpen}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <div
        className={`koma-mobile-menu ${menuOpen ? 'koma-mobile-menu--open' : ''}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Menu mobile">
          <a href="#produto" onClick={() => setMenuOpen(false)}>Produto</a>
          <a href="#solucoes" onClick={() => setMenuOpen(false)}>Soluções</a>
          <a
            href={KOMA_LANDING_CONFIG.demoAnchor}
            className="koma-btn koma-btn--primary"
            onClick={() => setMenuOpen(false)}
          >
            Solicitar demonstração
          </a>
          <a
            href={KOMA_LANDING_CONFIG.whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="koma-btn koma-btn--outline"
            onClick={() => setMenuOpen(false)}
            style={{ marginTop: '0.5rem' }}
          >
            Falar no WhatsApp ↗
          </a>
        </nav>
      </div>
    </>
  );
}
