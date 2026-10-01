import React from 'react';
import { renderToString } from 'react-dom/server';
import { AnimatePresence } from 'motion/react';
import LandingPage from './LandingPage';
import { KOMA_SLOGAN } from '../brand/komaBrand';
import { LANDING_SEO, landingStructuredData, serializeStructuredData } from './seo';

export function render() {
  return {
    // The existing public page is rendered without its entrance animations.
    // It must remain visible when a visitor/crawler does not execute JavaScript.
    html: renderToString(<AnimatePresence initial={false}><LandingPage /></AnimatePresence>),
    seo: LANDING_SEO,
    structuredData: serializeStructuredData(landingStructuredData(KOMA_SLOGAN)),
  };
}
