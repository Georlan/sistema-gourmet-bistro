import React, { useRef } from 'react';
import { motion } from 'motion/react';
import { HeroTabletScene } from '../product/HeroTabletScene';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';

const HERO_STRIP_ITEMS = [
  { num: '01', name: 'PDV BALCÃO' },
  { num: '02', name: 'GESTÃO DE MESAS' },
  { num: '03', name: 'KDS COZINHA' },
  { num: '04', name: 'CARDÁPIO QR' },
  { num: '05', name: 'IMPRESSÃO AUTOMÁTICA' },
];

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);

  return (
    <section ref={sectionRef} className="koma-hero" aria-label="Hero">
      <div className="koma-hero-grid-plane" aria-hidden="true" />
      <div className="koma-hero-orbit koma-hero-orbit--one" aria-hidden="true" />
      <div className="koma-hero-orbit koma-hero-orbit--two" aria-hidden="true" />

      <div className="koma-hero-grid">
        <motion.div
          className="koma-hero-content"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="koma-hero-eyebrow">
            <span className="koma-hero-live-dot" aria-hidden="true" />
            <span>Sistema operacional para restaurantes</span>
          </div>

          <h1 className="koma-hero-headline" aria-label="O restaurante não para">
            <span className="koma-hero-line">O restaurante</span>
            <span className="koma-hero-line koma-hero-line--accent">não para.</span>
          </h1>

          <motion.p
            className="koma-hero-sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
          >
            <span className="koma-hero-sub-bold">Seu sistema também não.</span>
            Salão, pedidos, cozinha e caixa trabalhando no mesmo ritmo — em uma operação que você enxerga por inteiro.
          </motion.p>

          <motion.div
            className="koma-hero-cta-group"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
          >
            <a href={KOMA_LANDING_CONFIG.demoAnchor} className="koma-btn koma-btn--primary">
              Solicitar demonstração
            </a>
            <a
              href={KOMA_LANDING_CONFIG.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="koma-hero-whatsapp-link"
            >
              Falar com um especialista <span aria-hidden="true">↗</span>
            </a>
          </motion.div>

          <motion.div
            className="koma-hero-proof"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.72 }}
            aria-label="Diferenciais do Kôma"
          >
            <span>Uma operação</span>
            <i aria-hidden="true" />
            <span>Qualquer tela</span>
            <i aria-hidden="true" />
            <span>Em tempo real</span>
          </motion.div>
        </motion.div>

        <div className="koma-hero-device-container">
          <div className="koma-hero-device-kicker" aria-hidden="true">
            <span>KÔMA / operação ao vivo</span>
            <span>01 — 05</span>
          </div>
          <HeroTabletScene className="koma-hero-device-frame" />
          <motion.div
            className="koma-hero-float-card koma-hero-float-card--top"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.65, delay: 0.7 }}
          >
            <span className="koma-hero-float-icon" aria-hidden="true">↗</span>
            <div>
              <strong>Salão em tempo real</strong>
              <small>Mesas e pedidos sincronizados</small>
            </div>
          </motion.div>
          <motion.div
            className="koma-hero-float-card koma-hero-float-card--bottom"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.82 }}
          >
            <span className="koma-hero-flow-dot" aria-hidden="true" />
            <span>Pedido</span><b aria-hidden="true">→</b><span>Cozinha</span><b aria-hidden="true">→</b><span>Caixa</span>
          </motion.div>
        </div>
      </div>

      <motion.div
        className="koma-hero-strip"
        role="list"
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.65 }}
      >
        {HERO_STRIP_ITEMS.map((item) => (
          <div key={item.num} className="koma-hero-strip-item" role="listitem">
            <span className="koma-hero-strip-num">{item.num}</span>
            <span className="koma-hero-strip-name">{item.name}</span>
          </div>
        ))}
      </motion.div>
    </section>
  );
}
