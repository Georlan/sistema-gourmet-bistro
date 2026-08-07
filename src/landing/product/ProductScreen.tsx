import React from 'react';

interface ProductScreenProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
}

export function ProductScreen({ view = 'mesas' }: ProductScreenProps) {
  if (view === 'cardapio') {
    return (
      <div style={{ background: '#0b0c12', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
        {/* Cardapio Topbar */}
        <div style={{ background: '#141622', padding: '12px 14px', borderBottom: '1px solid #222538', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#00b894' }}>❖ KÔMA CARDÁPIO</div>
          <span style={{ fontSize: '0.65rem', background: 'rgba(0,184,148,0.15)', color: '#00b894', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }}>MESA 04</span>
        </div>

        {/* Menu Content Loop */}
        <div style={{ flex: 1, padding: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ background: '#141622', border: '1px solid #222538', borderRadius: '6px', padding: '10px' }}>
            <div style={{ fontSize: '0.65rem', color: '#00b894', fontWeight: 700, textTransform: 'uppercase' }}>DESTAQUE DA CASA</div>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, margin: '2px 0' }}>Cheese Bacon 120g</div>
            <div style={{ fontSize: '0.7rem', color: '#888' }}>Pão brioche, hambúrguer 120g, queijo coalho, bacon e cheddar.</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
              <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: '#00b894' }}>R$ 25,00</span>
              <span style={{ background: '#00b894', color: '#0a0a0a', padding: '3px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 900 }}>+ ADICIONAR</span>
            </div>
          </div>

          <div style={{ background: '#141622', border: '1px solid #222538', borderRadius: '6px', padding: '10px' }}>
            <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700 }}>Batata Rústica 300g</div>
            <div style={{ fontSize: '0.7rem', color: '#888' }}>Acompanha molho especial de alho.</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
              <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: '#00b894' }}>R$ 18,00</span>
              <span style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', padding: '3px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700 }}>ADICIONADO</span>
            </div>
          </div>
        </div>

        {/* Cart Bottom Bar */}
        <div style={{ background: '#00b894', color: '#0a0a0a', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'Space Grotesk', fontWeight: 900, fontSize: '0.8rem' }}>
          <span>CARRINHO (2 ITENS)</span>
          <span>R$ 43,00 →</span>
        </div>
      </div>
    );
  }

  if (view === 'kds') {
    return (
      <div style={{ background: '#0b0c12', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ background: '#141622', padding: '12px 18px', borderBottom: '1px solid #222538', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>KÔMA KDS — MONITOR DA COZINHA</div>
          <span style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', padding: '4px 10px', fontSize: '0.7rem', borderRadius: '4px', fontWeight: 700 }}>3 PEDIDOS EM PRODUÇÃO</span>
        </div>

        <div style={{ flex: 1, padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <div style={{ background: '#141622', border: '1px solid #00b894', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', justify: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #222538', paddingBottom: '6px', marginBottom: '8px' }}>
                <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: '0.8rem', color: '#fff' }}>#0412 — MESA 03</span>
                <span style={{ color: '#00b894', fontSize: '0.7rem', fontWeight: 700 }}>⏱ 04:12</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#eee', margin: '4px 0' }}>2x Cheese Burguer</div>
              <div style={{ fontSize: '0.65rem', color: '#f59e0b' }}>🔴 OBS: Sem Salada</div>
            </div>
            <div style={{ background: '#00b894', color: '#0a0a0a', textAlign: 'center', padding: '6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 900 }}>CONCLUIR</div>
          </div>

          <div style={{ background: '#141622', border: '1px solid #222538', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', justify: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #222538', paddingBottom: '6px', marginBottom: '8px' }}>
                <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: '0.8rem', color: '#fff' }}>#0413 — MESA 04</span>
                <span style={{ color: '#aaa', fontSize: '0.7rem' }}>⏱ 01:45</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#eee', margin: '4px 0' }}>1x Cheese Bacon</div>
              <div style={{ fontSize: '0.75rem', color: '#eee' }}>1x Batata Rústica</div>
            </div>
            <div style={{ background: '#1e2132', color: '#888', textAlign: 'center', padding: '6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>EM PREPARO</div>
          </div>

          <div style={{ background: '#141622', border: '1px solid #222538', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', justify: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #222538', paddingBottom: '6px', marginBottom: '8px' }}>
                <span style={{ fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: '0.8rem', color: '#fff' }}>#0414 — DELIVERY</span>
                <span style={{ color: '#aaa', fontSize: '0.7rem' }}>⏱ 00:30</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#eee', margin: '4px 0' }}>3x Tradicional 120g</div>
            </div>
            <div style={{ background: '#1e2132', color: '#888', textAlign: 'center', padding: '6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700 }}>AGUARDANDO</div>
          </div>
        </div>
      </div>
    );
  }

  // DEFAULT REAL KÔMA MESA MAP (Matching user's actual app screenshot!)
  return (
    <div style={{ background: '#090a0f', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', color: '#fff', fontFamily: 'Inter, sans-serif' }}>
      {/* Real Topbar matching Kôma Caixa App */}
      <div style={{ height: '42px', background: '#0e1018', borderBottom: '1px solid #1c1f2e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.85rem', fontWeight: 800, color: '#00b894' }}>❖ Kôma Caixa</span>
          <span style={{ fontSize: '0.75rem', color: '#666' }}>|</span>
          <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#eee', letterSpacing: '0.04em' }}>GESTÃO DE ATENDIMENTO LOCAL</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ background: 'rgba(0,184,148,0.15)', color: '#00b894', border: '1px solid rgba(0,184,148,0.3)', padding: '3px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700 }}>Caixa Aberto</span>
          <span style={{ background: '#181b28', border: '1px solid #282c40', color: '#aaa', padding: '3px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 600 }}>✦ Modo PDV</span>
        </div>
      </div>

      {/* Navigation Subbar */}
      <div style={{ height: '34px', background: '#0b0c12', borderBottom: '1px solid #181a26', display: 'flex', alignItems: 'center', padding: '0 16px', gap: '16px' }}>
        <span style={{ fontSize: '0.7rem', color: '#666' }}>PEDIDOS</span>
        <span style={{ fontSize: '0.7rem', color: '#666' }}>BALCÃO</span>
        <span style={{ fontSize: '0.7rem', color: '#00b894', fontWeight: 700, borderBottom: '2px solid #00b894', paddingBottom: '6px' }}>MESAS (30)</span>
      </div>

      {/* Main Mesa Grid matching real screenshot */}
      <div style={{ flex: 1, padding: '14px', background: '#090a0f', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.75rem', color: '#aaa', fontWeight: 600 }}>Estrutura Física do Salão</span>
          <span style={{ background: '#00b894', color: '#0a0a0a', padding: '3px 8px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 900 }}>+ ADICIONAR MESA</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '10px', flex: 1 }}>
          {[
            { num: '1', status: 'free', val: '' },
            { num: '2', status: 'free', val: '' },
            { num: '3', status: 'occupied', val: 'R$ 25.80' },
            { num: '4', status: 'occupied', val: 'R$ 19.80' },
            { num: '5', status: 'free', val: '' },
            { num: '6', status: 'free', val: '' },
            { num: '7', status: 'free', val: '' },
            { num: '8', status: 'free', val: '' },
            { num: '9', status: 'free', val: '' },
            { num: '10', status: 'free', val: '' },
            { num: '11', status: 'free', val: '' },
            { num: '12', status: 'occupied', val: 'R$ 25.80' },
          ].map((m) => (
            <div
              key={m.num}
              style={{
                background: m.status === 'occupied' ? 'rgba(239, 68, 68, 0.08)' : '#10121a',
                border: `1px solid ${m.status === 'occupied' ? '#ef4444' : '#1c1f2e'}`,
                borderRadius: '8px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                justify: 'space-between',
                minHeight: '85px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>MESA {m.num}</span>
                <span style={{ fontSize: '0.55rem', padding: '2px 5px', borderRadius: '3px', fontWeight: 700, background: m.status === 'occupied' ? 'rgba(239, 68, 68, 0.2)' : '#1c1f2e', color: m.status === 'occupied' ? '#ef4444' : '#666' }}>
                  {m.status === 'occupied' ? 'OCUPADA' : 'LIVRE'}
                </span>
              </div>

              {m.status === 'occupied' ? (
                <div>
                  <div style={{ fontSize: '0.6rem', color: '#888' }}>CONSUMO TOTAL</div>
                  <div style={{ fontFamily: 'Space Grotesk', fontSize: '0.8rem', fontWeight: 700, color: '#00b894' }}>{m.val}</div>
                  <div style={{ background: '#00b894', color: '#0a0a0a', textAlign: 'center', padding: '3px', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 900, marginTop: '4px' }}>CHECKOUT</div>
                </div>
              ) : (
                <div style={{ fontSize: '0.65rem', color: '#444' }}>Disponível</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
