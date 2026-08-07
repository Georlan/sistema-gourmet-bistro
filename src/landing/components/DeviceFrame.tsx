import React from 'react';

const REAL_TABLES = [
  { num: '01', status: 'occupied', val: 'R$ 142,00', label: 'Em Consumo' },
  { num: '02', status: 'free', val: 'Livre', label: 'Disponível' },
  { num: '03', status: 'waiting', val: 'R$ 89,50', label: 'Aguardando' },
  { num: '04', status: 'occupied', val: 'R$ 215,00', label: 'Em Consumo' },
  { num: '05', status: 'free', val: 'Livre', label: 'Disponível' },
  { num: '06', status: 'occupied', val: 'R$ 54,00', label: 'Em Consumo' },
  { num: '07', status: 'waiting', val: 'R$ 310,00', label: 'Aguardando' },
  { num: '08', status: 'free', val: 'Livre', label: 'Disponível' },
];

export function DeviceFrame() {
  return (
    <div className="koma-real-tablet" aria-hidden="true">
      <div className="koma-real-screen">
        {/* Real Header */}
        <div className="koma-real-app-header">
          <div className="koma-real-app-title">
            <span style={{ color: '#00b894' }}>❖</span> KÔMA SALÃO
          </div>
          <span className="koma-real-app-badge">● OPERAÇÃO ATIVA</span>
        </div>

        {/* Real App Body */}
        <div className="koma-real-app-body">
          {/* Real Sidebar */}
          <div className="koma-real-sidebar">
            <div className="koma-real-sidebar-icon koma-real-sidebar-icon--active">⊞</div>
            <div className="koma-real-sidebar-icon">🍳</div>
            <div className="koma-real-sidebar-icon">💳</div>
            <div className="koma-real-sidebar-icon">🛵</div>
          </div>

          {/* Real Table Grid */}
          <div className="koma-real-grid">
            {REAL_TABLES.map((t) => (
              <div
                key={t.num}
                className={`koma-real-mesa koma-real-mesa--${t.status}`}
              >
                <div>
                  <div className="koma-real-mesa-num">Mesa {t.num}</div>
                  <div className="koma-real-mesa-status">{t.label}</div>
                </div>
                <div className="koma-real-mesa-val">{t.val}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
