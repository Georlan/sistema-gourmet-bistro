/**
 * Public marketing entry: avoids importing the 400 KB operational CSS into
 * the pre-rendered landing. Operational hosts still use src/main.tsx.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { AnalyticsProvider, initAnalytics } from '../analytics';
import LandingPage from './LandingPage';
import './public-base.css';

void initAnalytics();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AnalyticsProvider><LandingPage /></AnalyticsProvider>
  </React.StrictMode>,
);
