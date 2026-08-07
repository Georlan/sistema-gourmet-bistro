import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';

function RealMonitorScreen() {
  return (
    <div style={{ background: '#0d0e15', width: '100%', aspectRatio: '16 / 10', borderRadius: '10px', overflow: 'hidden', border: '2px solid #222538', boxShadow: '0 30px 80px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '36px', background: '#141622', borderBottom: '1px solid #222538', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>KÔMA PDV — CAIXA BALCÃO #01</span>
        <span style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', fontSize: '0.65rem', padding: '3px 8px', borderRadius: '4px', fontWeight: 700 }}>OPERACIONAL</span>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', gap: '12px', padding: '14px', background: '#0b0c12' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
          {['Mesa 01 - R$ 184,50', 'Mesa 03 - R$ 92,00', 'Mesa 04 - R$ 310,00', 'Mesa 06 - R$ 64,00', 'Mesa 07 - R$ 412,50', 'Mesa 09 - R$ 128,00'].map((m, i) => (
            <div key={i} style={{ background: '#141622', border: '1px solid #222538', borderRadius: '6px', padding: '10px', display: 'flex', flexDirection: 'column', justify: 'space-between' }}>
              <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>{m.split('-')[0]}</span>
              <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#00b894' }}>{m.split('-')[1]}</span>
            </div>
          ))}
        </div>
        <div style={{ background: '#141622', border: '1px solid #222538', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#fff', borderBottom: '1px solid #222538', paddingBottom: '8px' }}>FECHAMENTO ATIVO</div>
            <div style={{ fontSize: '0.75rem', color: '#aaa', margin: '8px 0' }}>Mesa 04 — Carlos</div>
            <div style={{ fontSize: '0.75rem', color: '#888' }}>Subtotal: R$ 310,00</div>
          </div>
          <div style={{ background: '#00b894', color: '#0a0a0a', padding: '8px', borderRadius: '4px', textAlign: 'center', fontFamily: 'Space Grotesk', fontSize: '0.75rem', fontWeight: 900 }}>CONCLUIR VENDA (PIX)</div>
        </div>
      </div>
    </div>
  );
}

function RealTabletScreen() {
  return (
    <div style={{ background: '#0d0e15', width: '100%', aspectRatio: '4 / 3', borderRadius: '10px', overflow: 'hidden', border: '2px solid #222538', boxShadow: '0 25px 60px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '32px', background: '#141622', borderBottom: '1px solid #222538', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px' }}>
        <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>GARÇOM APP</span>
        <span style={{ color: '#00b894', fontSize: '0.65rem', fontWeight: 600 }}>MESA 04</span>
      </div>
      <div style={{ flex: 1, padding: '10px', background: '#0b0c12', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {['2x Cheese Bacon 120g', '1x Batata Rústica 300g', '2x Sucos Laranja 500ml'].map((item, idx) => (
          <div key={idx} style={{ background: '#141622', padding: '6px 10px', borderRadius: '4px', border: '1px solid #222538', display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#eee' }}>
            <span>{item}</span>
            <span style={{ color: '#00b894', fontWeight: 600 }}>OK</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RealPhoneScreen() {
  return (
    <div style={{ background: '#0d0e15', width: '100%', aspectRatio: '9 / 16', borderRadius: '14px', overflow: 'hidden', border: '2px solid #222538', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: '28px', background: '#141622', borderBottom: '1px solid #222538', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: '#00b894' }}>
        CARDÁPIO QR CODE
      </div>
      <div style={{ flex: 1, padding: '8px', background: '#0b0c12', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ height: '40px', background: '#141622', borderRadius: '4px', border: '1px solid #222538' }} />
        <div style={{ height: '40px', background: '#141622', borderRadius: '4px', border: '1px solid #222538' }} />
        <div style={{ height: '40px', background: '#141622', borderRadius: '4px', border: '1px solid #222538' }} />
      </div>
    </div>
  );
}

export function Ecosystem() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.15 });

  return (
    <section ref={ref} className="koma-ecosystem-section" aria-label="Ecossistema">
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={isInView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.8 }}
      >
        <h2 className="koma-eco-title">
          TUDO ONDE<br />PRECISA ESTAR.
        </h2>
        <p className="koma-eco-subtitle">
          PDV Balcão. Gestão de Mesas. KDS Cozinha. Cardápio Digital. Delivery. Impressão Automática.
        </p>
      </motion.div>

      {/* Nixon-inspired Physical Object Composition (Full Bleed Right Edge Crop) */}
      <div className="koma-eco-stage">
        {/* Dominant Monitor Object (780px) */}
        <motion.div
          className="koma-eco-monitor"
          initial={{ opacity: 0, x: 60 }}
          animate={isInView ? { opacity: 1, x: 0 } : {}}
          transition={{ duration: 1, delay: 0.1 }}
        >
          <RealMonitorScreen />
        </motion.div>

        {/* Overlapping Tablet Object (420px) */}
        <motion.div
          className="koma-eco-tablet"
          initial={{ opacity: 0, y: 50 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, delay: 0.25 }}
        >
          <RealTabletScreen />
        </motion.div>

        {/* Foreground Smartphone Object (240px) */}
        <motion.div
          className="koma-eco-phone"
          initial={{ opacity: 0, y: 70 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 1, delay: 0.4 }}
        >
          <RealPhoneScreen />
        </motion.div>
      </div>

      {/* Pure Editorial Labels directly in composition (NO cards/boxes) */}
      <div className="koma-eco-labels-grid">
        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">01 / CAIXA</span>
          <h3 className="koma-eco-label-name">OPERAÇÃO NO BALCÃO</h3>
          <p className="koma-eco-label-desc">Abertura, fechamento, sangrias e emissão fiscal sem complicações.</p>
        </div>

        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">02 / GARÇOM</span>
          <h3 className="koma-eco-label-name">PEDIDO DIRETO DA MESA</h3>
          <p className="koma-eco-label-desc">Lançamento ágil com envio instantâneo para a produção na cozinha.</p>
        </div>

        <div className="koma-eco-label-item">
          <span className="koma-eco-label-num">03 / CARDÁPIO</span>
          <h3 className="koma-eco-label-name">AUTONOMIA QR CODE</h3>
          <p className="koma-eco-label-desc">Cardápio digital na mesa para consulta e pedidos sem fila de espera.</p>
        </div>
      </div>
    </section>
  );
}
