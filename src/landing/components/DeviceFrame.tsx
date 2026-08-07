import React from 'react';

const TABLE_STATES = [
  'empty', 'active', 'empty', 'occupied',
  'empty', 'active', 'active', 'empty',
  'occupied', 'empty', 'empty', 'active',
] as const;

export function DeviceFrame() {
  return (
    <div className="koma-device-tablet" aria-hidden="true">
      <div className="koma-device-screen">
        <div className="koma-device-sidebar">
          <div className="koma-device-dot koma-device-dot--active" />
          <div className="koma-device-dot" />
          <div className="koma-device-dot" />
          <div className="koma-device-dot" />
          <div className="koma-device-dot" />
        </div>
        <div className="koma-device-main">
          <div className="koma-device-topbar" />
          <div className="koma-device-grid">
            {TABLE_STATES.map((state, i) => (
              <div
                key={i}
                className={`koma-device-card koma-device-card--${state}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
