import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import logoImg from '../../assets/logo-koma-on-dark.png';
import { TabletFrame } from '../product/TabletFrame';
import { KOMA_LANDING_CONFIG } from '../config/landingConfig';
import { LeadCaptureModal } from '../components/LeadCaptureModal';
import { WhatsAppIcon } from '../components/WhatsAppIcon';

const HERO_STRIP_ITEMS = [
  {
    num: '01',
    name: 'PEDIDO ENTRA UMA VEZ',
    detail: 'Retirada, delivery, garçom e cardápio no mesmo fluxo.',
    href: '#como-funciona',
  },
  {
    num: '02',
    name: 'MESAS ATUALIZADAS AO VIVO',
    detail: 'Status e consumo visíveis para todo o salão.',
    href: '#gestao',
  },
  {
    num: '03',
    name: 'COZINHA RECEBE NA HORA',
    detail: 'Itens e observações chegam sem novo repasse.',
    href: '#como-funciona',
  },
  {
    num: '04',
    name: 'CLIENTE PEDE PELO CELULAR',
    detail: 'Cardápio digital conectado à operação.',
    href: '#cardapio-digital',
  },
  {
    num: '05',
    name: 'COMANDA SAI AUTOMATICAMENTE',
    detail: 'A impressão acompanha o pedido certo.',
    href: '#impressao',
  },
];

const HERO_LIVE_STEPS = [
  { view: 'mesas' as const, label: 'PEDIDO RECEBIDO', detail: 'Mesa 04 entrou na operação' },
  { view: 'kds' as const, label: 'COZINHA ATUALIZADA', detail: 'Produção recebeu os itens' },
  { view: 'mesas' as const, label: 'MESA SINCRONIZADA', detail: 'Salão acompanha o status' },
  { view: 'cardapio' as const, label: 'CARDÁPIO CONECTADO', detail: 'Disponibilidade em um só lugar' },
];

const HERO_BENEFITS = [
  'MENOS PEDIDOS ERRADOS',
  'SALÃO E COZINHA SINCRONIZADOS',
  'CAIXA E IMPRESSÃO SOB CONTROLE',
];

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [liveStep, setLiveStep] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setLiveStep((current) => (current + 1) % HERO_LIVE_STEPS.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, []);

  const activeStep = HERO_LIVE_STEPS[liveStep];

  return (
    <section ref={sectionRef} className="koma-hero" aria-label="Apresentação do Kôma">
      <div className="koma-hero-color-plane" aria-hidden="true" />

      <div className="koma-hero-grid">
        <motion.div
          className="koma-hero-content"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.p
            className="koma-hero-eyebrow"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
          >
            SISTEMA DE GESTÃO PARA RESTAURANTES, BARES E LANCHONETES
          </motion.p>

          <h1 className="koma-hero-headline" aria-label="O restaurante não para. Seu sistema também não.">
            <span className="koma-hero-line koma-hero-line--sm">O</span>
            <span className="koma-hero-title-axis">
              <span className="koma-hero-line koma-hero-line--xl">RESTAURANTE</span>
              <span className="koma-hero-bar-wrap" aria-hidden="true">
                <motion.span
                  className="koma-hero-bar"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: 0.75, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
                />
              </span>
            </span>
            <span className="koma-hero-line koma-hero-line--lg koma-hero-line--accent">NÃO PARA.</span>
          </h1>

          <motion.p
            className="koma-hero-sub"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.45 }}
          >
            Do pedido ao fechamento, mesas, salão, cozinha, impressão e caixa trabalham com a mesma informação em tempo real.
          </motion.p>

          <motion.ul
            className="koma-hero-benefits"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.5 }}
          >
            {HERO_BENEFITS.map((benefit) => (
              <li key={benefit}><i aria-hidden="true" />{benefit}</li>
            ))}
          </motion.ul>

          <motion.div
            className="koma-hero-cta-group"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
          >
            <button type="button" className="koma-btn koma-btn--primary" onClick={() => setLeadModalOpen(true)}>
              Quero ver o Kôma funcionando
            </button>
            <a
              href={KOMA_LANDING_CONFIG.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="koma-hero-whatsapp-link"
            >
              <WhatsAppIcon />
              Falar direto no WhatsApp
            </a>
          </motion.div>

          <motion.p
            className="koma-hero-cta-note"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.66 }}
          >
            Demonstração rápida e sem compromisso.
          </motion.p>

          <motion.div
            className="koma-hero-brand-signature"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.72 }}
          >
            <img src={logoImg} alt="" aria-hidden="true" />
            <span>Se você está com fome, <strong>Kôma</strong></span>
          </motion.div>
        </motion.div>

        <div className="koma-hero-device-container">
          <TabletFrame view={activeStep.view} className="koma-hero-device-frame" />
          <motion.div
            key={activeStep.label}
            className="koma-hero-live-status"
            initial={{ opacity: 0, x: 12, rotate: 7 }}
            animate={{ opacity: 1, x: 0, rotate: 7 }}
            transition={{ duration: 0.42 }}
          >
            <span><i aria-hidden="true" /> OPERAÇÃO AO VIVO</span>
            <strong>{activeStep.label}</strong>
            <small>{activeStep.detail}</small>
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
          <a
            key={item.num}
            className="koma-hero-strip-item"
            href={item.href}
            role="listitem"
            aria-label={`${item.name}. ${item.detail}`}
          >
            <span className="koma-hero-strip-num">{item.num}</span>
            <span className="koma-hero-strip-copy">
              <strong className="koma-hero-strip-name">{item.name}</strong>
              <small className="koma-hero-strip-detail">{item.detail}</small>
            </span>
          </a>
        ))}
      </motion.div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </section>
  );
}
