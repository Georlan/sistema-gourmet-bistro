import React from 'react';
import { MesasView } from '../../components/mesas/MesasView';
import { KitchenPanel } from '../../components/KitchenPanel';
import CardapioPage from '../../cardapio/CardapioPage';
import { getMarketingDemoData } from './MarketingDemoProvider';

interface ProductScreenProps {
  view?: 'mesas' | 'pdv' | 'kds' | 'cardapio' | 'delivery';
  scaleLogicalWidth?: number;
}

export function ProductScreen({ view = 'mesas', scaleLogicalWidth = 1280 }: ProductScreenProps) {
  const { salonTables, orders } = getMarketingDemoData();

  const renderRealComponent = () => {
    switch (view) {
      case 'kds':
        return (
          <KitchenPanel
            orders={orders}
            onFinishPreparation={() => {}}
            currentTime={Date.now()}
          />
        );
      case 'cardapio':
        return <CardapioPage />;
      case 'mesas':
      default:
        return (
          <MesasView
            salonTables={salonTables}
            orders={orders}
            readOnly={true}
          />
        );
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative',
        background: '#0a0a0a',
        pointerEvents: 'none', // Disables operational actions in marketing preview
        userSelect: 'none',
      }}
    >
      <div
        style={{
          width: `${scaleLogicalWidth}px`,
          minHeight: '800px',
          transformOrigin: 'top left',
          transform: 'scale(var(--koma-preview-scale, 1))',
        }}
        className="koma-real-app-viewport"
      >
        {renderRealComponent()}
      </div>
    </div>
  );
}
