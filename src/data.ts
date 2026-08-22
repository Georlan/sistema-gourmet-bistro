/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Table } from './types';

// ============================================================================
// 🏢 CONFIGURAÇÕES DE PERSONALIZAÇÃO (SaaS / White-Label)
// Altere as variáveis abaixo para customizar o app para outro cliente rapidamente.
// ============================================================================
export const RESTAURANT_CONFIG = {
  nomePadrao: "Kôma",
  totalMesas: 30,           // Define o número total de mesas exibidas no mapa
  capacidadePadraoMesa: 4,  // Capacidade padrão de pessoas por mesa
};

// Gera as mesas dinamicamente com base nas configurações White-Label
export const TABLES: Table[] = Array.from({ length: RESTAURANT_CONFIG.totalMesas }, (_, idx) => ({
  id: idx + 1,
  capacidade: RESTAURANT_CONFIG.capacidadePadraoMesa
}));
