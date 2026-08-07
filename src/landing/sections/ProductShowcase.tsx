import React, { useRef } from 'react';
import { motion, useInView } from 'motion/react';

export function ProductShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const isInView = useInView(sectionRef, { once: true, amount: 0.2 });

  return (
    <section
      ref={sectionRef}
      className="koma-section-white"
      id="produto"
      aria-label="Produto"
    >
      {/* Title + Editorial Copy (Grid Layout) */}
      <div className="koma-showcase-header">
        <motion.h2
          className="koma-showcase-title"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8 }}
        >
          DO SALÃO<br />À COZINHA.
        </motion.h2>

        <motion.div
          className="koma-showcase-editorial"
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="koma-showcase-item">
            <span className="koma-showcase-item-num">01 / MESAS</span>
            <p className="koma-showcase-item-desc">
              Visão da operação em tempo real. Status de consumo, tempo de permanência e garçom responsável em uma única tela.
            </p>
          </div>
          <div className="koma-showcase-item">
            <span className="koma-showcase-item-num">02 / PEDIDOS</span>
            <p className="koma-showcase-item-desc">
              Lançado uma vez no garçom ou QR Code. Produção e caixa acompanham sem papel e sem ruído.
            </p>
          </div>
        </motion.div>
      </div>

      {/* Massive Product Display (85-90% Viewport Width) with Annotations */}
      <motion.div
        className="koma-showcase-display"
        initial={{ opacity: 0, y: 50, scale: 0.98 }}
        animate={isInView ? { opacity: 1, y: 0, scale: 1 } : {}}
        transition={{ duration: 1, delay: 0.3 }}
      >
        {/* Pointer Annotations */}
        <div className="koma-annotation" style={{ top: '-18px', left: '15%' }}>
          <div className="koma-annotation-dot" />
          <div className="koma-annotation-label">01 ── MAPA DE MESAS EM TEMPO REAL</div>
        </div>

        <div className="koma-annotation" style={{ top: '-18px', right: '15%' }}>
          <div className="koma-annotation-dot" />
          <div className="koma-annotation-label">02 ── STATUS DE ATENDIMENTO</div>
        </div>

        {/* Real KÔMA Full Interface View */}
        <div className="koma-showcase-frame">
          <div style={{ background: '#141622', padding: '12px 20px', borderBottom: '1px solid #222538', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>
              <span style={{ color: '#00b894' }}>KÔMA GESTÃO</span>
              <span style={{ color: '#666' }}>|</span>
              <span style={{ color: '#aaa', fontWeight: 500 }}>Salão Principal (30 Mesas)</span>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <span style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px', fontWeight: 600 }}>12 Ocupadas</span>
              <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px', fontWeight: 600 }}>4 Aguardando</span>
              <span style={{ background: '#1e2132', color: '#888', padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px' }}>14 Livres</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', padding: '16px', background: '#0b0c12', minHeight: '380px' }}>
            {[
              { num: '01', val: 'R$ 184,50', status: 'occupied', waiter: 'Carlos', time: '38 min', items: '4 itens' },
              { num: '02', val: 'Livre', status: 'free', waiter: '-', time: '-', items: '0 itens' },
              { num: '03', val: 'R$ 92,00', status: 'waiting', waiter: 'Ana', time: '52 min', items: '3 itens' },
              { num: '04', val: 'R$ 310,00', status: 'occupied', waiter: 'Carlos', time: '1h 12m', items: '8 itens' },
              { num: '05', val: 'Livre', status: 'free', waiter: '-', time: '-', items: '0 itens' },
              { num: '06', val: 'R$ 64,00', status: 'occupied', waiter: 'Lucas', time: '15 min', items: '2 itens' },
              { num: '07', val: 'R$ 412,50', status: 'waiting', waiter: 'Carlos', time: '1h 40m', items: '12 itens' },
              { num: '08', val: 'Livre', status: 'free', waiter: '-', time: '-', items: '0 itens' },
              { num: '09', val: 'R$ 128,00', status: 'occupied', waiter: 'Ana', time: '28 min', items: '3 itens' },
              { num: '10', val: 'Livre', status: 'free', waiter: '-', time: '-', items: '0 itens' },
            ].map((t) => (
              <div
                key={t.num}
                style={{
                  background: t.status === 'occupied' ? 'rgba(0, 184, 148, 0.08)' : t.status === 'waiting' ? 'rgba(245, 158, 11, 0.08)' : '#141622',
                  border: `1px solid ${t.status === 'occupied' ? '#00b894' : t.status === 'waiting' ? '#f59e0b' : '#222538'}`,
                  borderRadius: '6px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  justify: 'space-between',
                  minHeight: '90px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>Mesa {t.num}</span>
                  <span style={{ fontSize: '0.65rem', color: '#777' }}>{t.time}</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: '#888', margin: '4px 0' }}>Garçom: {t.waiter}</div>
                <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: t.status === 'occupied' ? '#00b894' : t.status === 'waiting' ? '#f59e0b' : '#555' }}>
                  {t.val}
                </div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  );
}
