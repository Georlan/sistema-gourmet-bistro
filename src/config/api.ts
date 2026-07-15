/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const isLocalHost = window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  /^(\d{1,3}\.){3}\d{1,3}$/.test(window.location.hostname);

const envApiUrl = (import.meta as any).env?.VITE_API_URL;
const envWsUrl = (import.meta as any).env?.VITE_WS_URL;

// Base HTTP API URL
export const API_BASE_URL = envApiUrl || (isLocalHost
  ? `${window.location.protocol}//${window.location.hostname}:8000`
  : 'https://sistema-gourmet-bistro-production.up.railway.app');

// Base WebSocket URL
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsHost = isLocalHost ? `${window.location.hostname}:8000` : 'sistema-gourmet-bistro-production.up.railway.app';

export const WS_BASE_URL = envWsUrl || `${wsProtocol}//${wsHost}`;
