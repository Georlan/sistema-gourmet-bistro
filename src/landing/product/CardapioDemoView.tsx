import React from 'react';
import logoKoma from '../../assets/logo-koma-on-dark.png';

export function CardapioDemoView() {
  const categories = ['Destacados', 'Burgers', 'Acompanhamentos', 'Bebidas'];
  const activeCategory = 'Burgers';

  const products = [
    {
      id: 1,
      name: 'Kôma Smash Bacon',
      desc: 'Dois hambúrgueres smash 90g, cheddar artesanal, bacon crocante e molho da casa.',
      price: 'R$ 32,90',
      badge: 'Mais Pedido',
    },
    {
      id: 2,
      name: 'Kôma Trufado',
      desc: 'Burger 160g de blend nobre, queijo brie derretido e maionese de trufas brancas.',
      price: 'R$ 44,00',
    },
    {
      id: 3,
      name: 'Batata Rústica 250g',
      desc: 'Batatas rústicas fritas com alecrim fresco e maionese aioli artesanal.',
      price: 'R$ 19,80',
    },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#0d0e15',
        color: '#ffffff',
        fontFamily: 'Inter, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header with Brand Logo */}
      <div
        style={{
          padding: '16px 16px 12px 16px',
          background: '#121420',
          borderBottom: '1px solid #1a1d2e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={logoKoma} alt="KÔMA" style={{ height: '24px', width: 'auto' }} />
          <div>
            <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>KÔMA BISTRO</div>
            <div style={{ fontSize: '0.65rem', color: '#00b894', fontWeight: 600 }}>Mesa 04 • Atendimento Aberto</div>
          </div>
        </div>
        <div style={{ background: 'rgba(0, 184, 148, 0.15)', color: '#00b894', fontSize: '0.65rem', fontWeight: 700, padding: '4px 8px', borderRadius: '4px' }}>
          Cardápio QR
        </div>
      </div>

      {/* Categories Bar */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          padding: '10px 14px',
          background: '#090a0f',
          borderBottom: '1px solid #161824',
          overflowX: 'auto',
        }}
      >
        {categories.map((cat) => {
          const isActive = cat === activeCategory;
          return (
            <div
              key={cat}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.7rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                background: isActive ? '#00b894' : '#141624',
                color: isActive ? '#0a0a0a' : 'rgba(255, 255, 255, 0.7)',
              }}
            >
              {cat}
            </div>
          );
        })}
      </div>

      {/* Product List */}
      <div style={{ flex: 1, padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', overflowY: 'auto' }}>
        {products.map((item) => (
          <div
            key={item.id}
            style={{
              background: '#121420',
              border: '1px solid #1a1d2e',
              borderRadius: '8px',
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {item.badge && (
              <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#00b894', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ★ {item.badge}
              </span>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#ffffff' }}>{item.name}</div>
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#00b894' }}>{item.price}</div>
            </div>
            <div style={{ fontSize: '0.65rem', color: '#888999', lineHeight: 1.35 }}>{item.desc}</div>
          </div>
        ))}
      </div>

      {/* Bottom Cart Bar */}
      <div
        style={{
          padding: '10px 14px',
          background: '#121420',
          borderTop: '1px solid #1a1d2e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: '0.6rem', color: '#777' }}>1 item selecionado</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fff' }}>R$ 32,90</div>
        </div>
        <div
          style={{
            background: '#00b894',
            color: '#0a0a0a',
            fontSize: '0.75rem',
            fontWeight: 800,
            padding: '8px 14px',
            borderRadius: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Enviar Pedido
        </div>
      </div>
    </div>
  );
}
