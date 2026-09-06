/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */


import { SlidersHorizontal } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOperationalCatalog } from './components/app/data/useOperationalCatalog';
import { useOperationalOrders } from './components/app/data/useOperationalOrders';
import { useOperationalTables } from './components/app/data/useOperationalTables';
import { useOperationalDrafts } from './components/app/drafts/useOperationalDrafts';
import { OperationalSnapshotLoading } from './components/app/OperationalSnapshotLoading';
import { KitchenPanel } from './components/KitchenPanel';
import { KomaLogo } from './components/KomaLogo';
import { MesaDetailsModal } from './components/MesaDetailsModal';
import { AppRouteBoundary } from './components/app/AppRouteBoundary';
import { OperationalDrawer } from './components/app/OperationalDrawer';
import { SupportSessionBanner } from './components/app/SupportSessionBanner';
import { OperationalLogin } from './components/auth/OperationalLogin';
import { MesasView } from './components/mesas/MesasView';
import { API_BASE_URL, WS_BASE_URL } from './config/api';
import { KOMA_THEME_CHANGED_EVENT, nextKomaTheme, persistKomaTheme, readKomaTheme, type KomaTheme } from './config/theme';
import { RESTAURANT_CONFIG } from './data';
import { countWaiterSalonTables, projectWaiterSalonTables } from './domain/waiterSalonProjection';
import { AppRole, AppSettings, CaixaTurnoResumo } from './types';
import { authFetch, authRequestErrorMessage } from './utils/authRequest';
import { getOperatorSession, saveOperatorSession } from './utils/authSession';
import { openAuthenticatedWebSocket } from './utils/authenticatedWebSocket';
import { operationalFetch } from './utils/operationalRequest';
import { aplicarMascaraTelefoneInput } from './utils/phonePresentation';

// Route modules have stable identities and are downloaded only when selected.
// Authentication stays in App; shared data and draft owners remain mounted here.
const CardapioPage = React.lazy(() => import('./cardapio/CardapioPage'));
const LandingPage = React.lazy(() => import('./landing/LandingPage'));
const SuperAdminGate = React.lazy(() => import('./super-admin/SuperAdminGate').then(module => ({ default: module.SuperAdminGate })));
const CaixaAtivarPage = React.lazy(() => import('./components/CaixaAtivarPage').then(module => ({ default: module.CaixaAtivarPage })));
const MotoboyPwaPage = React.lazy(() => import('./components/MotoboyPwaPage').then(module => ({ default: module.MotoboyPwaPage })));

const MemoizedCaixaPanel = React.lazy(() =>
  import('./components/CaixaPanel').then(module => ({
    default: module.MemoizedCaixaPanel
  }))
);

const CashierLoading = () => (
  <div className="w-full h-full bg-koma-page text-koma-accent flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.18em]">
    Preparando operação…
  </div>
);

const LOCAL_STORAGE_SETTINGS_KEY = 'koma_settings_vFinal_v3';
const LOCAL_STORAGE_RESTAURANT_NAME_KEY = 'koma_restaurant_name_v3';
const LOCAL_STORAGE_HIST_CLIENTS_KEY = 'koma_historic_clients_v3';

const MANAGEMENT_ROLES = new Set<AppRole>(['admin', 'gerente', 'caixa']);
const isManagementRole = (role: AppRole) => MANAGEMENT_ROLES.has(role);


const readJwtSubject = (token: string): string => {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return '';
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(window.atob(padded));
    return String(payload?.sub || '').trim();
  } catch {
    return '';
  }
};

export default function App() {
  const isSuperAdmin = window.location.pathname.startsWith('/super-admin');

  if (isSuperAdmin) {
    return <AppRouteBoundary label="administração"><SuperAdminGate /></AppRouteBoundary>;
  }

  // Detect activation page (?view=ativar or /ativar)
  const isAtivar = window.location.pathname.startsWith('/ativar') ||
                   window.location.search.includes('view=ativar');
  if (isAtivar) {
    const tokenFromUrl = new URLSearchParams(window.location.search).get('token');
    return <AppRouteBoundary label="ativação"><CaixaAtivarPage token={tokenFromUrl} /></AppRouteBoundary>;
  }

  // Detect motoboy PWA page (/entregador or ?view=entregador)
  const isEntregador = window.location.pathname.startsWith('/entregador') ||
                       window.location.search.includes('view=entregador');
  if (isEntregador) {
    return <AppRouteBoundary label="entregador"><MotoboyPwaPage /></AppRouteBoundary>;
  }

  // Detect KÔMA Landing Page (/landing or ?view=landing)
  const isLanding = window.location.pathname.startsWith('/landing') ||
                    window.location.search.includes('view=landing');
  if (isLanding) {
    return <AppRouteBoundary label="apresentação"><LandingPage /></AppRouteBoundary>;
  }

  // Detect if access is client cardapio (online menu)
  const isCardapio = window.location.pathname.startsWith('/cardapio') ||
                     window.location.search.includes('view=cardapio') ||
                     (window.location.hostname !== 'localhost' &&
                      window.location.hostname !== '127.0.0.1' &&
                      !window.location.hostname.includes('sistema-gourmet-bistro') &&
                      !window.location.hostname.includes('pages.dev') &&
                      window.location.hostname.split('.').length > 2 &&
                      window.location.hostname.split('.')[0] !== 'www');

  if (isCardapio) {
    return <AppRouteBoundary label="cardápio"><CardapioPage /></AppRouteBoundary>;
  }

  // 1. Roles & Active user state (Strictly 'garcom')
  // 1. Detect portal (garcom or caixa/management) from URL query parameters or hashes
  const [portal, setPortal] = useState<'garcom' | 'caixa'>(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const viewParam = searchParams.get('view');
    const hash = window.location.hash;

    if (viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia') {
      return 'caixa';
    }
    return 'garcom';
  });

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    const key = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    return !!localStorage.getItem(key);
  });
  const [activeWaiterId, setActiveWaiterId] = useState<string>(() => {
    const key = portal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
    const storedId = localStorage.getItem(key);
    if (storedId || portal !== 'caixa') return storedId || "";
    return String(getOperatorSession()?.user?.id || "");
  });
  const [activeWaiterNome, setActiveWaiterNome] = useState<string>(() => {
    const key = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
    const storedName = localStorage.getItem(key);
    if (storedName || portal !== 'caixa') return storedName || "";
    return String(getOperatorSession()?.user?.nome || "");
  });
  const activeWaiter = { id: activeWaiterId, nome: activeWaiterNome };
  const [activeRole, setActiveRole] = useState<AppRole>(() => {
    if (portal === 'caixa') {
      return (localStorage.getItem("koma_caixa_role") as AppRole)
        || (getOperatorSession()?.user?.role as AppRole)
        || 'caixa';
    }
    return 'garcom';
  });
  const operationalScopeKey = useMemo(
    () => isAuthenticated && activeWaiterId ? `${portal}:${activeRole}:${activeWaiterId}` : '',
    [activeRole, activeWaiterId, isAuthenticated, portal],
  );
  const operationalScopeKeyRef = useRef(operationalScopeKey);
  operationalScopeKeyRef.current = operationalScopeKey;

  // Listen to URL changes to switch portal dynamically
  const [restauranteConfig, setRestauranteConfig] = useState<any>(null);
  const [pagamentosPendentes, setPagamentosPendentes] = useState<any[]>([]);
  const [pendingPaymentsLoadedScopeKey, setPendingPaymentsLoadedScopeKey] = useState('');
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [waiterAvailable, setWaiterAvailable] = useState<boolean>(true);

  useEffect(() => {
    setPagamentosPendentes([]);
    setPendingPaymentsLoadedScopeKey('');
  }, [operationalScopeKey]);

  // Helper to get headers for API calls including JWT
  const getAuthHeaders = useCallback((contentType = "application/json") => {
    const headers: any = {};
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    const token = localStorage.getItem(tokenKey);
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
  }, [portal]);

  // Mantém a identidade do objeto estável. Isso preserva a memoização do painel
  // e evita que efeitos de leitura sejam reexecutados por renders sem relação.
  const managementAuthHeaders = useMemo(
    () => getAuthHeaders(),
    [getAuthHeaders, isAuthenticated, activeWaiterId],
  );

  const printPairingStartedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nonce = params.get('pair_print_agent');
    const portText = params.get('agent_port');
    if (!nonce || !portText || !isAuthenticated || printPairingStartedRef.current) return;

    const port = Number(portText);
    if (!Number.isInteger(port) || port < 17654 || port > 17664) return;

    printPairingStartedRef.current = true;

    const authorizePrintAgent = async () => {
      const jwt = localStorage.getItem('koma_caixa_token');
      if (!jwt) {
        printPairingStartedRef.current = false;
        return;
      }

      try {
        const registerResponse = await fetch(`${API_BASE_URL}/api/print-agents/register`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${jwt}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            agent_id: `desktop-${nonce.slice(0, 12)}`
          })
        });
        const registration = await registerResponse.json().catch(() => null);
        if (!registerResponse.ok || !registration?.agent_token) {
          throw new Error('Não foi possível configurar a impressão neste computador.');
        }

        const localResponse = await fetch(`http://127.0.0.1:${port}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce,
            token: registration.agent_token
          })
        });
        if (!localResponse.ok) {
          throw new Error('Não foi possível concluir a configuração da impressão.');
        }

        params.delete('pair_print_agent');
        params.delete('agent_port');
        const query = params.toString();
        window.history.replaceState(
          null,
          '',
          `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
        );
        window.alert('Impressão configurada. O teste já pode ser enviado.');
      } catch (error) {
        printPairingStartedRef.current = false;
        const message = error instanceof Error
          ? error.message
          : 'Não foi possível configurar a impressão.';
        window.alert(message);
      }
    };

    void authorizePrintAgent();
  }, [isAuthenticated]);

  const fetchPagamentosPendentes = async () => {
    const requestScopeKey = operationalScopeKey;
    if (!requestScopeKey) return;
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      if (!token) return;

      const res = await fetch(`${API_BASE_URL}/caixa/pagamentos/pendentes`, {
        headers: getAuthHeaders()
      });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (requestScopeKey !== operationalScopeKeyRef.current) return;
        setPagamentosPendentes(data);
        setPendingPaymentsLoadedScopeKey(requestScopeKey);
      }
    } catch (err) {
      console.error("Error fetching pending payments:", err);
    }
  };

  const fetchConfig = async () => {
    try {
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey);
      if (!token) return;

      const res = await fetch(`${API_BASE_URL}/caixa/configuracoes`, {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const data = await res.json();
        setRestauranteConfig(data);
        setIsConfigLoaded(true);
      }
    } catch (err) {
      console.error("Error fetching configs in App:", err);
    }
  };

  const [turnoResumo, setTurnoResumo] = useState<CaixaTurnoResumo | null>(null);
  const [isTurnoResumoLoading, setIsTurnoResumoLoading] = useState(false);
  const turnoResumoRequestRef = useRef(0);

  const fetchTurnoResumo = useCallback(async () => {
    const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    if (!isAuthenticated || !localStorage.getItem(tokenKey)) {
      setTurnoResumo(null);
      setIsTurnoResumoLoading(false);
      return;
    }

    // O resumo financeiro pertence ao caixa. Evita 403 no portal do garçom
    // sem enfraquecer a autorização do backend.
    if (!isManagementRole(activeRole)) {
      setTurnoResumo(null);
      setIsTurnoResumoLoading(false);
      return;
    }

    const requestId = ++turnoResumoRequestRef.current;
    setIsTurnoResumoLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/caixa/turno-atual/resumo`, { headers: getAuthHeaders() }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        if (data && requestId === turnoResumoRequestRef.current) {
          setTurnoResumo(data);
        }
      }
    } catch (e) {
      // Ignora silenciosamente erros 403 ou de permissão no modo garçom
    } finally {
      if (requestId === turnoResumoRequestRef.current) {
        setIsTurnoResumoLoading(false);
      }
    }
  }, [activeRole, getAuthHeaders, isAuthenticated, portal]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchConfig();
    fetchTurnoResumo();
  }, [operationalScopeKey, fetchTurnoResumo]);

  useEffect(() => {
    if (!isAuthenticated || isWsConnected) return;
    const interval = setInterval(() => {
      fetchConfig();
      fetchTurnoResumo();
    }, 15000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isWsConnected, operationalScopeKey, fetchTurnoResumo]);

  useEffect(() => {
    const handleUrlChange = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const viewParam = searchParams.get('view');
      const hash = window.location.hash;
      let newPortal: 'caixa' | 'garcom' = (viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia') ? 'caixa' : 'garcom';

      setPortal(newPortal);

      const tokenKey = newPortal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const idKey = newPortal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
      const nameKey = newPortal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
      const roleKey = newPortal === 'caixa' ? "koma_caixa_role" : "koma_user_role";

      setIsAuthenticated(!!localStorage.getItem(tokenKey));
      const operatorSession = newPortal === 'caixa' ? getOperatorSession() : null;
      setActiveWaiterId(
        localStorage.getItem(idKey)
        || String(operatorSession?.user?.id || "")
      );
      setActiveWaiterNome(
        localStorage.getItem(nameKey)
        || String(operatorSession?.user?.nome || "")
      );

      if (newPortal === 'caixa') {
        setActiveRole(
          (localStorage.getItem(roleKey) as AppRole)
          || (operatorSession?.user?.role as AppRole)
          || 'caixa'
        );
      } else {
        setActiveRole('garcom');
      }

      const tableKey = `koma_${newPortal}_selected_table_v3`;
      const savedTable = localStorage.getItem(tableKey);
      setSelectedTableId(savedTable ? parseInt(savedTable, 10) : null);
    };

    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, [portal]);

  // Toast notification system
  interface Toast { id: number; message: string; type: 'success' | 'error' | 'info'; }
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message: string, type: Toast['type'] = 'success', duration = 3000) => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
  }, []);

  // Login Form States
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginRestaurantOptions, setLoginRestaurantOptions] = useState<Array<{ id: number; nome: string }>>([]);
  const [loginRestaurantId, setLoginRestaurantId] = useState("");

  // Logout handler
  const handleLogout = useCallback(() => {
    const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
    const idKey = portal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
    const nameKey = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
    const roleKey = portal === 'caixa' ? "koma_caixa_role" : "koma_user_role";

    localStorage.removeItem(tokenKey);
    localStorage.removeItem(idKey);
    localStorage.removeItem(nameKey);
    localStorage.removeItem(roleKey);

    setIsAuthenticated(false);
    setActiveWaiterId("");
    setActiveWaiterNome("");
    setActiveRole(portal === 'caixa' ? "caixa" : "garcom");
    setIsSidebarOpen(false);
  }, [portal]);

  // Sidebar Open State
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);

  const [fontSize, setFontSize] = useState<'padrao' | 'grande' | 'gigante'>(() => {
    return (localStorage.getItem('koma_font_size') as any) || 'padrao';
  });

  const changeFontSize = (size: 'padrao' | 'grande' | 'gigante') => {
    localStorage.setItem('koma_font_size', size);
    setFontSize(size);
    window.dispatchEvent(new Event('koma_font_size_changed'));
  };

  useEffect(() => {
    const handleStorageChange = () => {
      const stored = localStorage.getItem('koma_font_size') as any;
      if (stored && ['padrao', 'grande', 'gigante'].includes(stored)) {
        setFontSize(stored);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('koma_font_size_changed', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('koma_font_size_changed', handleStorageChange);
    };
  }, []);

  const [theme, setTheme] = useState<KomaTheme>(() => readKomaTheme());

  const toggleTheme = () => {
    setTheme(persistKomaTheme(nextKomaTheme(theme)));
  };

  useEffect(() => {
    const handleThemeChange = () => setTheme(readKomaTheme());
    window.addEventListener('storage', handleThemeChange);
    window.addEventListener(KOMA_THEME_CHANGED_EVENT, handleThemeChange);
    return () => {
      window.removeEventListener('storage', handleThemeChange);
      window.removeEventListener(KOMA_THEME_CHANGED_EVENT, handleThemeChange);
    };
  }, []);

  // 1.5. Dynamic Salon Tables State and Fetcher
  const [fetchError, setFetchError] = useState<string | null>(null);
  const {
    salonTables,
    setSalonTables,
    fetchTables,
    handleCreateMesa,
    handleUpdateMesa,
    handleDeleteMesa,
    isTablesLoaded,
  } = useOperationalTables({
    setFetchError,
    getAuthHeaders,
    handleLogout,
    showToast,
    scopeKey: operationalScopeKey,
  });

  // Prevents duplicate API calls when clicking Pronto/Entregar rapidly
  const inflightItemIdsRef = useRef<Set<string>>(new Set());
  // Prevents duplicate API calls for critical table operations (close, transfer, merge)
  const inflightTableOpsRef = useRef<Set<string>>(new Set());

  // Create Mesa

  // Update Mesa

  // Delete Mesa

  // Editable Restaurant Name State
  const [restaurantName, setRestaurantName] = useState<string>(() => {
    return localStorage.getItem(LOCAL_STORAGE_RESTAURANT_NAME_KEY) || RESTAURANT_CONFIG.nomePadrao;
  });

  // Table filter state
  const [tableFilter, setTableFilter] = useState<'todos' | 'livres' | 'ocupadas' | 'prontas'>('todos');

  // Pre-loading states for smooth intro transition
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const { isProductsLoaded, liveProdutos, liveCategorias, fetchLiveCatalog } = useOperationalCatalog({ portal, handleLogout, isAuthenticated, isWsConnected });

  useEffect(() => {
    setRestauranteConfig(null);
    setIsConfigLoaded(false);
  }, [operationalScopeKey]);

  // 2. Live products loaded from backend (includes ativo field for availability blocking)

  // 2b. Orders loaded from API

  const {
    orders,
    setOrders,
    ordersRef,
    isOrdersLoaded,
    fetchOrdersFromAPI,
    fetchOrderByIdFromAPI,
    handleOptimisticUpdateItemStatus,
    handleOptimisticAddOrder,
    handleTransferTableOptimistic,
  } = useOperationalOrders({
    liveProdutos,
    getAuthHeaders,
    handleLogout,
    setFetchError,
    scopeKey: operationalScopeKey,
  });

  const isOperationalSnapshotReady = Boolean(operationalScopeKey)
    && isTablesLoaded
    && isOrdersLoaded
    && (!isManagementRole(activeRole) || pendingPaymentsLoadedScopeKey === operationalScopeKey);

   // Synchronous guard against double-click race condition

  // 3. App View Settings
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem(LOCAL_STORAGE_SETTINGS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error loading settings from localStorage', e);
      }
    }
    const searchParams = new URLSearchParams(window.location.search);
    const viewParam = searchParams.get('view');
    const hash = window.location.hash;
    const isCaixa = viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia';
    return { exibirImagens: isCaixa, exibirDescricoes: isCaixa };
  });

  // 4. Modal focus state
  const [selectedTableId, setSelectedTableId] = useState<number | null>(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const viewParam = searchParams.get('view');
    const hash = window.location.hash;
    const initialPortal = (viewParam === 'caixa' || viewParam === 'gerencia' || hash === '#caixa' || hash === '#gerencia') ? 'caixa' : 'garcom';
    const saved = localStorage.getItem(`koma_${initialPortal}_selected_table_v3`);
    return saved ? parseInt(saved, 10) : null;
  });

  const handleTableClick = useCallback((tableId: number) => {
    if (!isOperationalSnapshotReady) return;
    const targetMesaId = ordersRef.current.find(o => o.mesaOrigemId === tableId)?.mesaId;
    if (targetMesaId) {
      setSelectedTableId(targetMesaId);
    } else {
      setSelectedTableId(tableId);
    }
  }, [isOperationalSnapshotReady]);

  useEffect(() => {
    const key = `koma_${portal}_selected_table_v3`;
    if (selectedTableId !== null) {
      localStorage.setItem(key, selectedTableId.toString());
    } else {
      localStorage.removeItem(key);
    }
  }, [selectedTableId, portal]);

  // 5. Live clock tracker to update permanency timers automatically every 30 seconds (reduces re-renders)
  const { isSubmitting, drafts, getDraftItems, handleAddToDraft, handleRemoveFromDraft, handleUpdateDraftItem, handleEditDraftItems, handleSubmitDraft } = useOperationalDrafts({ activeWaiterNome, orders, setOrders, activeWaiterId, setSelectedTableId, showToast, fetchOrdersFromAPI, getAuthHeaders });

  const [currentTime, setCurrentTime] = useState<number>(Date.now());

  useEffect(() => {
    // O caixa mantém o próprio relógio de SLA. Evita renderizar novamente todo
    // o painel administrativo apenas para atualizar o relógio do salão.
    if (isManagementRole(activeRole)) return;
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, [activeRole]);

  // WebSocket Live Real-Time & Draft Sincronização
  interface ActiveDraftInfo {
    garcomNome: string;
    timestamp: number;
  }
  const [activeDrafts, setActiveDrafts] = useState<{ [mesaId: number]: { [garcomId: string]: ActiveDraftInfo } }>({});
  const wsRef = useRef<WebSocket | null>(null);
  const lastDraftStatusesRef = useRef<{ [mesaId: number]: boolean }>({});

  const notifyDraftStatus = (mesaId: number, hasDraft: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({
          action: "draft_status",
          mesa_id: mesaId,
          garcom_nome: activeWaiterNome,
          ativo: hasDraft
        }));
      } catch (err) {
        console.error("Error sending draft status via WebSocket:", err);
      }
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !activeWaiterId) {
      if (wsRef.current) {
        wsRef.current.close();
      }
      return;
    }

    let activeSocket: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    let wsUpdateTimeout: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    let currentDelay = 2000;
    let hasOpenedOnce = false;

    type RealtimeRefreshFlags = {
      orders?: boolean;
      tables?: boolean;
      catalog?: boolean;
      config?: boolean;
      summary?: boolean;
      payments?: boolean;
    };

    let pendingRefresh: RealtimeRefreshFlags = {};

    // Vários endpoints publicam eventos próximos entre si. Consolida a rajada
    // e busca somente os recursos realmente afetados pela mudança.
    const scheduleRealtimeRefresh = (flags: RealtimeRefreshFlags, delayMs = 90) => {
      pendingRefresh = { ...pendingRefresh, ...flags };
      if (wsUpdateTimeout) clearTimeout(wsUpdateTimeout);
      wsUpdateTimeout = setTimeout(() => {
        const refresh = pendingRefresh;
        pendingRefresh = {};

        if (refresh.orders) fetchOrdersFromAPI();
        if (refresh.tables) fetchTables();
        if (refresh.catalog) fetchLiveCatalog();
        if (refresh.config) fetchConfig();
        if (refresh.summary) fetchTurnoResumo();
        if (refresh.payments && isManagementRole(activeRole)) {
          fetchPagamentosPendentes();
        }
        if (refresh.orders || refresh.tables) {
          window.dispatchEvent(new Event('koma_orders_updated'));
        }
      }, delayMs);
    };

    const connectWS = () => {
      if (stopped || document.hidden) return;

      const existing = wsRef.current;
      if (
        existing
        && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = undefined;
      }

      const wsBase = WS_BASE_URL.replace(/\/+$/, '');
      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const token = localStorage.getItem(tokenKey) || "";
      const wsIdentity = readJwtSubject(token) || activeWaiterId;
      if (!token || !wsIdentity) return;
      const wsUrl = `${wsBase}/ws/${encodeURIComponent(wsIdentity)}`;
      const socket = openAuthenticatedWebSocket(wsUrl, token);
      activeSocket = socket;
      wsRef.current = socket;

      socket.onopen = () => {
        if (stopped || wsRef.current !== socket) return;
        console.log("WebSocket connection established");
        const isReconnect = hasOpenedOnce;
        hasOpenedOnce = true;
        setIsWsConnected(true);
        currentDelay = 2000;
        if (isReconnect) {
          fetchTables();
          fetchOrdersFromAPI();
          if (isManagementRole(activeRole)) fetchPagamentosPendentes();
          fetchTurnoResumo();
        }
        // Reconcilia visões gerenciais após quedas silenciosas de conexão.
        // Os listeners só consultam dados quando a respectiva tela está aberta.
        window.dispatchEvent(new Event('koma_team_updated'));
        window.dispatchEvent(new Event('koma_reports_updated'));
      };

      socket.onmessage = (event) => {
        if (stopped || wsRef.current !== socket) return;
        try {
          const data = JSON.parse(event.data);
          const eventName = data.event || data.type;

          if (
            eventName === "new_delivery_order"
            || eventName === "ORDER_UPDATED"
            || eventName === "NEW_ORDER"
            || eventName === "order_updated"
            || eventName === "order_status_updated"
          ) {
            scheduleRealtimeRefresh({ orders: true });
          }
          if (eventName === "print_monitor_updated") {
            // Atualização silenciosa: o painel refaz a consulta sem toast,
            // som ou interrupção do operador.
            window.dispatchEvent(
              new Event('koma_print_monitor_refresh')
            );
          }
          if (eventName === "customers_updated") {
            window.dispatchEvent(new Event('koma_customers_updated'));
          }
          if (eventName === "team_updated") {
            window.dispatchEvent(new Event('koma_team_updated'));
            window.dispatchEvent(new Event('koma_reports_updated'));
          }
          if (eventName === "catalog_updated") {
            scheduleRealtimeRefresh({ catalog: true });
            window.dispatchEvent(new Event('koma_reports_updated'));
          }
          if (eventName === "config_updated" || eventName === "CONFIG_UPDATE") {
            scheduleRealtimeRefresh({ config: true });
          }
          if (eventName === "cash_updated") {
            scheduleRealtimeRefresh({ summary: true });
            window.dispatchEvent(new Event('koma_cash_updated'));
            window.dispatchEvent(new Event('koma_reports_updated'));
          }
          if (eventName === "tables_updated" || eventName === "TABLE_UPDATED") {
            const detailType = String(data.detail?.type || '');
            const isLayoutChange = detailType === 'layout_mesa_atualizado';
            const isComandaOpened = detailType === 'comanda_aberta';
            const isLaunchCreated = detailType === 'lancamento_criado';

            if (isLayoutChange || isComandaOpened) {
              // Abrir a comanda ocupa a mesa, mas ainda não existe pedido para o Kanban.
              // Atualizar orders aqui causava um estado intermediário vazio e alerta duplicado.
              scheduleRealtimeRefresh({ tables: true });
            } else if (isLaunchCreated) {
              // O evento já informa qual comanda mudou. Evita reconstruir todo o salão
              // no caminho crítico de um novo pedido.
              const comandaId = String(data.detail?.comanda_id || '').trim();
              if (comandaId) {
                void fetchOrderByIdFromAPI(comandaId);
                scheduleRealtimeRefresh({ tables: true, summary: true }, 0);
              } else {
                // Compatibilidade defensiva com produtores antigos sem comanda_id.
                scheduleRealtimeRefresh({ orders: true, tables: true, summary: true }, 0);
              }
            } else {
              // Compatibilidade com eventos legados e demais mutações de mesa.
              scheduleRealtimeRefresh({
                orders: true,
                tables: true,
                summary: true,
                payments: true
              });
            }
            if (data.detail && data.detail.type === "pagamento_registrado" && data.detail.status === "pendente") {
              showToast(`Confirmar recebimento em dinheiro: R$ ${data.detail.valor.toFixed(2)} - Garçom ${data.detail.garcom_nome}`, 'info', 5000);
            }
            if (data.detail?.type === "pagamento_registrado") {
              window.dispatchEvent(new Event('koma_reports_updated'));
            }
          } else if (eventName === "MESA_ATUALIZADA" || eventName === "MESA_UPDATED") {
            scheduleRealtimeRefresh({ orders: true });
            const mesaUpdate = data.data || data;
            const mesaId = Number(mesaUpdate.mesa_id);
            const status = String(mesaUpdate.status || '').toLowerCase();
            const comandaId = mesaUpdate.comanda_id ?? null;
            if (!Number.isFinite(mesaId) || mesaId <= 0) return;
            if (status === 'livre') {
              setOrders(prevOrders => prevOrders.filter(o => o.mesaId !== mesaId));
            }
            setSalonTables(prevTables =>
              prevTables.map(t => t.id === mesaId ? { ...t, status, comanda_id: comandaId } : t)
            );
            if (status === 'livre' && portal === 'garcom' && navigator.vibrate) {
              navigator.vibrate(100);
            }
          } else if (eventName === "draft_status") {
            const { mesa_id, garcom_id, garcom_nome, ativo } = data;
            setActiveDrafts(prev => {
              const updated = { ...prev };
              if (!updated[mesa_id]) {
                updated[mesa_id] = {};
              } else {
                updated[mesa_id] = { ...updated[mesa_id] };
              }
              if (ativo) {
                updated[mesa_id][garcom_id] = {
                  garcomNome: garcom_nome,
                  timestamp: Date.now()
                };
              } else {
                delete updated[mesa_id][garcom_id];
                if (Object.keys(updated[mesa_id]).length === 0) {
                  delete updated[mesa_id];
                }
              }
              return updated;
            });
          } else if (eventName === "waiter_connected" || eventName === "waiter_disconnected") {
            const { garcom_id } = data;
            setActiveDrafts(prev => {
              const updated = { ...prev };
              let changed = false;
              Object.keys(updated).forEach(mId => {
                const mesaId = Number(mId);
                if (updated[mesaId][garcom_id]) {
                  updated[mesaId] = { ...updated[mesaId] };
                  delete updated[mesaId][garcom_id];
                  changed = true;
                  if (Object.keys(updated[mesaId]).length === 0) {
                    delete updated[mesaId];
                  }
                }
              });
              return changed ? updated : prev;
            });
          }
        } catch (err) {
          console.error("Error handling WebSocket message:", err);
        }
      };

      socket.onclose = () => {
        if (stopped || wsRef.current !== socket) return;
        setIsWsConnected(false);
        wsRef.current = null;
        if (!document.hidden) {
          console.log(`WebSocket disconnected, reconnecting in ${currentDelay}ms`);
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connectWS, currentDelay);
          currentDelay = Math.min(currentDelay * 1.5, 30000);
        }
      };

      socket.onerror = (err) => {
        console.error("WebSocket connection error:", err);
      };
    };

    const handleVisibilityChange = () => {
      if (document.hidden || stopped) return;
      const socket = wsRef.current;
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        currentDelay = 2000;
        connectWS();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connectWS();

    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (wsUpdateTimeout) clearTimeout(wsUpdateTimeout);
      if (activeSocket) {
        activeSocket.onopen = null;
        activeSocket.onmessage = null;
        activeSocket.onclose = null;
        activeSocket.onerror = null;
        activeSocket.close();
      }
      if (wsRef.current === activeSocket) wsRef.current = null;
    };
  }, [isAuthenticated, activeWaiterId, activeRole, portal, fetchLiveCatalog]);

  // Sync local draft changes to WebSocket
  useEffect(() => {
    if (!isAuthenticated || !activeWaiterId || !isWsConnected || activeRole !== 'garcom') return;

    const currentStatuses: { [mesaId: number]: boolean } = {};
    const mesaIds = new Set<number>([
      ...salonTables.map(table => table.id),
      ...Object.keys(drafts).map(Number),
      ...Object.keys(lastDraftStatusesRef.current).map(Number)
    ]);

    mesaIds.forEach((mId) => {
      if (!Number.isFinite(mId) || mId <= 0) return;
      const hasDraft = (drafts[mId] || []).length > 0;
      const isViewing = selectedTableId === mId;
      const isActive = hasDraft || isViewing;
      currentStatuses[mId] = isActive;

      const prev = lastDraftStatusesRef.current[mId] || false;
      if (isActive !== prev) {
        notifyDraftStatus(mId, isActive);
      }
    });
    lastDraftStatusesRef.current = currentStatuses;
  }, [drafts, selectedTableId, salonTables, isAuthenticated, activeWaiterId, isWsConnected, activeRole]);

  // Reset statuses ref on disconnect to trigger fresh sync upon reconnect
  useEffect(() => {
    if (!isWsConnected) {
      lastDraftStatusesRef.current = {};
    }
  }, [isWsConnected]);

  // 6. Persistence effects
  // Synchronized via polling instead of localStorage

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_RESTAURANT_NAME_KEY, restaurantName);
  }, [restaurantName]);

  // Lock body scroll when sidebar/drawer is open
  useEffect(() => {
    if (isSidebarOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  // Physical back button / swipe back closes the active modal
  useEffect(() => {
    const handlePopState = () => {
      if (selectedTableId !== null) {
        setSelectedTableId(null);
      }
    };

    if (selectedTableId !== null) {
      window.history.pushState({ modalOpen: true }, "");
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [selectedTableId]);

  // Waiter persistence managed by login state

  // Get draft items for a waiter at a specific table

  // 7. Core Order Actions

  // Bootstrap has one owner. WebSocket first-open does not duplicate it; polling is fallback only.
  useEffect(() => {
    if (!operationalScopeKey) return;
    fetchOrdersFromAPI();
    fetchTables();
    if (isManagementRole(activeRole)) {
      fetchPagamentosPendentes();
    }
  }, [operationalScopeKey]);

  useEffect(() => {
    if (!operationalScopeKey) return;

    const refreshOperationalSnapshot = () => {
      fetchOrdersFromAPI();
      fetchTables();
      if (isManagementRole(activeRole)) {
        fetchPagamentosPendentes();
      }
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) refreshOperationalSnapshot();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Once a valid snapshot exists, WebSocket invalidations own realtime refreshes.
    // Before that, keep a fallback retry even if the socket itself is connected.
    if (isWsConnected && isOperationalSnapshotReady) {
      return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
    }

    const interval = setInterval(() => {
      if (document.hidden) return;
      refreshOperationalSnapshot();
    }, 8000);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [activeRole, isOperationalSnapshotReady, isWsConnected, operationalScopeKey]);

  // Login handler
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    const usernameClean = loginUsername.trim().toLowerCase();
    const requestPayload: Record<string, unknown> = {
      username: usernameClean,
      password: loginPassword,
    };
    if (loginRestaurantId) requestPayload.restaurante_id = Number(loginRestaurantId);

    try {
      const response = await authFetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        const detail = err?.detail;
        const detailRecord = detail && typeof detail === 'object'
          ? detail as Record<string, any>
          : null;
        const restaurantOptions = response.status === 409
          && detailRecord?.code === 'restaurant_selection_required'
          && Array.isArray(detailRecord.restaurantes)
          ? detailRecord.restaurantes
              .map((item: any) => ({
                id: Number(item?.id),
                nome: String(item?.nome || `Restaurante ${item?.id || ''}`).trim(),
              }))
              .filter((item: { id: number; nome: string }) => Number.isInteger(item.id) && item.id > 0)
          : [];

        if (restaurantOptions.length > 0) {
          setLoginRestaurantOptions(restaurantOptions);
          setLoginRestaurantId("");
          setLoginError(
            typeof detailRecord?.message === 'string'
              ? detailRecord.message
              : 'Selecione o estabelecimento para continuar.',
          );
          return;
        }

        const detailMessage = typeof detail === 'string'
          ? detail
          : typeof detailRecord?.message === 'string'
            ? detailRecord.message
            : "Usuário ou senha incorretos.";
        setLoginError(detailMessage);
        return;
      }
      const data = await response.json();

      const role = String(data.usuario?.role || data.usuario?.cargo || '').trim().toLowerCase() as AppRole;
      if (!role) {
        setLoginError("A conta não possui um perfil de acesso válido. Procure o administrador do estabelecimento.");
        return;
      }
      if (portal === 'caixa' && !isManagementRole(role)) {
        setLoginError("Acesso negado. Use uma conta de caixa, gerente ou administrador.");
        return;
      }
      if (portal === 'garcom' && role !== 'garcom' && role !== 'admin') {
        setLoginError("Acesso negado. Apenas garçons.");
        return;
      }

      const tokenKey = portal === 'caixa' ? "koma_caixa_token" : "koma_waiter_token";
      const idKey = portal === 'caixa' ? "koma_caixa_id" : "koma_waiter_id";
      const nameKey = portal === 'caixa' ? "koma_caixa_name" : "koma_waiter_name";
      const roleKey = portal === 'caixa' ? "koma_caixa_role" : "koma_user_role";

      if (portal === 'caixa') {
        saveOperatorSession(data.access_token, { ...data.usuario, role });
      } else {
        localStorage.setItem(tokenKey, data.access_token);
        localStorage.setItem(idKey, data.usuario.id);
        localStorage.setItem(nameKey, data.usuario.nome);
        localStorage.setItem(roleKey, role);
      }

      setActiveWaiterId(data.usuario.id);
      setActiveWaiterNome(data.usuario.nome);
      setActiveRole(role);
      setIsAuthenticated(true);
      setLoginUsername("");
      setLoginPassword("");
      setLoginRestaurantOptions([]);
      setLoginRestaurantId("");
    } catch (err) {
      console.error(err);
      setLoginError(authRequestErrorMessage(err, "Erro ao conectar ao servidor do backend."));
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 8. Table Transfer (Transfers all active comandas of sourceTableId to targetTableId)
  const handleTransferTable = async (sourceTableId: number, targetTableId: number) => {
    const opKey = `transfer-${sourceTableId}`;
    if (inflightTableOpsRef.current.has(opKey)) return;
    inflightTableOpsRef.current.add(opKey);
    const sourceComandas = orders.filter(o => o.mesaId === sourceTableId);
    if (sourceComandas.length === 0) { inflightTableOpsRef.current.delete(opKey); return; }

    try {
      // O endpoint atual transfere toda a família da mesa. Uma única chamada
      // evita repetir a mesma mutação quando existem comandas irmãs.
      const primaryComanda = sourceComandas[0];
      const res = await operationalFetch(`${API_BASE_URL}/comandas/${primaryComanda.id}/transferir/${targetTableId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        showToast(errData?.detail || 'Não foi possível transferir a mesa.', 'error');
        await fetchOrdersFromAPI();
        return;
      }

      handleTransferTableOptimistic(sourceTableId, targetTableId);
      setSelectedTableId(null);
      await fetchOrdersFromAPI();
      showToast(`Mesa ${sourceTableId} transferida para a Mesa ${targetTableId}.`, 'success');
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao transferir mesas.", 'error');
      await fetchOrdersFromAPI();
    } finally {
      inflightTableOpsRef.current.delete(opKey);
    }
  };

  // 8.5. Unify/Split (Merge and Unmerge) Tables
  const handleMergeTables = async (sourceMesaId: number, targetMesaId: number) => {
    const opKey = `merge-${sourceMesaId}-${targetMesaId}`;
    if (inflightTableOpsRef.current.has(opKey)) return;
    inflightTableOpsRef.current.add(opKey);
    // 0ms Optimistic UI update: merge itens da mesa origem na mesa destino
    handleTransferTableOptimistic(sourceMesaId, targetMesaId);
    setSelectedTableId(null);
    try {
      const res = await operationalFetch(`${API_BASE_URL}/comandas/mesclar?mesa_origem_id=${sourceMesaId}&mesa_destino_id=${targetMesaId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast(`Mesa ${sourceMesaId} mesclada na Mesa ${targetMesaId} com sucesso!`);
        fetchOrdersFromAPI();
      } else {
        const errData = await res.json();
        showToast(`Erro ao mesclar mesas: ${errData.detail}`, 'error');
        fetchOrdersFromAPI();
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao mesclar mesas.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightTableOpsRef.current.delete(opKey);
    }
  };

  const handleUnmergeTable = async (comandaId: string) => {
    try {
      const res = await operationalFetch(`${API_BASE_URL}/comandas/desmesclar?comanda_id=${comandaId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (res.ok) {
        showToast("Mesa desmembrada com sucesso!");
        setSelectedTableId(null);
        fetchOrdersFromAPI();
      } else {
        const errData = await res.json();
        showToast(`Erro ao desmembrar mesa: ${errData.detail}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao desmembrar mesa.", 'error');
    }
  };

  // 9. Close Table (Settle whole balance) - Restricted to Cashier
  const handleCloseTable = async (mesaId: number) => {
    if (activeRole !== 'caixa') {
      showToast('Apenas o operador de Caixa possui autorização para encerrar contas.', 'error');
      return;
    }

    const tableComandas = orders.filter(o => o.mesaId === mesaId);
    if (tableComandas.length === 0) return;

    // 0ms: remove a mesa do estado local imediatamente
    setOrders(prev => prev.filter(o => o.mesaId !== mesaId));
    setSelectedTableId(null);
    showToast(`Mesa ${mesaId} encerrada e liberada.`, 'success');

    try {
      for (const comanda of tableComandas) {
        const res = await fetch(`${API_BASE_URL}/comandas/${comanda.id}/fechar`, {
          method: "PUT",
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          const errData = await res.json();
          showToast(`Erro ao fechar comanda: ${errData.detail}`, 'error');
          fetchOrdersFromAPI(); // Rollback
          return;
        }
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao encerrar mesa.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  // 9.5. Clear Table Orders (Direct reset - Testing only)
  const handleClearTableOrders = async (mesaId: number) => {
    const tableComandas = orders.filter(o => o.mesaId === mesaId);
    try {
      for (const comanda of tableComandas) {
        await fetch(`${API_BASE_URL}/comandas/${comanda.id}/fechar`, {
          method: "PUT",
          headers: getAuthHeaders()
        });
      }
      setSelectedTableId(null);
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
    }
  };

  // 10. Settle single customer consumption (Partial payment) - Restricted to Cashier
  const handleSettleCustomer = async (mesaId: number, customerName: string) => {
    if (activeRole !== 'caixa') {
      showToast('Apenas o Caixa pode liquidar o consumo de um cliente específico.', 'error');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/comandas/?mesa_id=${mesaId}&fechada=false`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) return;
      const comandas = await response.json();

      const targetComanda = comandas.find((c: any) => {
        const normIdent = c.identificador || "Consumo Geral";
        return normIdent === customerName;
      });

      if (!targetComanda) {
        showToast("Comanda do cliente não encontrada para liquidar.", 'error');
        return;
      }

      const res = await fetch(`${API_BASE_URL}/comandas/${targetComanda.id}/fechar`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao liquidar comanda do cliente: ${errData.detail}`, 'error');
        return;
      }
      showToast(`Consumo de "${customerName}" liquidado com sucesso.`, 'success');
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao liquidar cliente.", 'error');
    }
  };

  // Optimistic Item Status Update (Instant 0ms UI response)

  // Optimistic Add Order (Instant 0ms UI response for PDV)

  // Optimistic Payment Removal (Instant 0ms UI response)
  const handleRemovePendingPaymentOptimistic = (pagamentoId: string) => {
    setPagamentosPendentes(prev => prev.filter(p => p.id !== pagamentoId));
  };

  // Optimistic Table Transfer (Instant 0ms UI response)

  // 11. Delivery (Waiter serves a ready dish)
  const handleDeliverItem = async (orderId: string, itemId: string) => {
    if (inflightItemIdsRef.current.has(itemId)) return; // Ignore rapid duplicate clicks
    inflightItemIdsRef.current.add(itemId);
    handleOptimisticUpdateItemStatus(itemId, 'entregue');
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/status?status=entregue`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        showToast("Erro ao entregar item no backend.", 'error');
        fetchOrdersFromAPI();
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao marcar item como entregue.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightItemIdsRef.current.delete(itemId);
    }
  };

  const handlePrintReceipt = async (mesaId: number, apenasValores: boolean = false) => {
    const url = `${API_BASE_URL}/mesas/${mesaId}/imprimir-recibo?apenas_valores=${apenasValores}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Erro ao imprimir recibo");
    }
  };

  const handlePrintKitchenLaunch = async (lancamentoId: string) => {
    const response = await fetch(`${API_BASE_URL}/comandas/lancamentos/${lancamentoId}/reimprimir`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.detail || "Erro ao reimprimir lote");
    }
  };

  // 12. Kitchen - Chef completes cooking a plate
  const handleFinishPreparation = async (orderId: string, itemId: string) => {
    if (inflightItemIdsRef.current.has(itemId)) return; // Ignore rapid duplicate clicks
    inflightItemIdsRef.current.add(itemId);
    handleOptimisticUpdateItemStatus(itemId, 'pronto');
    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/status?status=pronto`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        showToast("Erro ao finalizar preparação no backend.", 'error');
        fetchOrdersFromAPI();
      }
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao finalizar preparação.", 'error');
      fetchOrdersFromAPI();
    } finally {
      inflightItemIdsRef.current.delete(itemId);
    }
  };

  // 13. Transfer single item to a different table
  const handleTransferItem = async (itemId: string, targetTableId: number) => {
    // 0ms: remove item da mesa origem imediatamente
    setOrders(prev => prev.map(o => ({ ...o, itens: o.itens.filter(it => it.id !== itemId) })));
    showToast(`Item transferido para a Mesa ${targetTableId}.`, 'success');

    try {
      const res = await operationalFetch(`${API_BASE_URL}/comandas/itens/${itemId}/transferir/${targetTableId}`, {
        method: "POST",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao transferir item: ${errData.detail}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        return;
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao transferir item.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  const handleTransferItems = async (itemIds: string[], targetTableId: number) => {
    // 0ms: remove itens da mesa origem imediatamente
    const idSet = new Set(itemIds);
    setOrders(prev => prev.map(o => ({ ...o, itens: o.itens.filter(it => !idSet.has(it.id)) })));
    showToast(`${itemIds.length} itens transferidos para a Mesa ${targetTableId}.`, 'success');

    try {
      let failMessage = "";
      for (const itemId of itemIds) {
        const res = await operationalFetch(`${API_BASE_URL}/comandas/itens/${itemId}/transferir/${targetTableId}`, {
          method: "POST",
          headers: getAuthHeaders()
        });
        if (!res.ok) {
          const errData = await res.json();
          failMessage = errData.detail || "Erro desconhecido";
        }
      }
      if (failMessage) {
        showToast(`Falha ao transferir alguns itens: ${failMessage}`, 'error');
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao transferir itens.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  // 14. Cancel single item
  const handleCancelItem = async (itemId: string) => {
    // 0ms: remove item do estado local imediatamente
    setOrders(prev => prev.map(o => ({ ...o, itens: o.itens.filter(it => it.id !== itemId) })));
    showToast('Item cancelado.', 'success');

    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}/cancelar`, {
        method: "PUT",
        headers: getAuthHeaders()
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao cancelar item: ${errData.detail}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        return;
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao cancelar item.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  const handleUpdateItemDetails = async (itemId: string, observacao: string, clienteNome: string, quantidadeAdicional?: number) => {
    // 0ms: atualiza observação e nome do cliente localmente
    setOrders(prev => prev.map(o => ({
      ...o,
      itens: o.itens.map(it =>
        it.id === itemId ? { ...it, observacao, clienteNome } : it
      )
    })));
    showToast('Item atualizado.', 'success');

    try {
      const res = await fetch(`${API_BASE_URL}/comandas/itens/${itemId}`, {
        method: "PUT",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          observacao,
          cliente_nome: clienteNome,
          quantidade_adicional: quantidadeAdicional || undefined
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        showToast(`Erro ao editar item: ${errData.detail}`, 'error');
        fetchOrdersFromAPI(); // Rollback
        return;
      }
      fetchOrdersFromAPI();
    } catch (err) {
      console.error(err);
      showToast("Erro de conexão ao atualizar item.", 'error');
      fetchOrdersFromAPI(); // Rollback
    }
  };

  const waiterTableRows = useMemo(
    () => isOperationalSnapshotReady
      ? projectWaiterSalonTables(salonTables, orders, pagamentosPendentes, currentTime)
      : [],
    [isOperationalSnapshotReady, salonTables, orders, pagamentosPendentes, currentTime],
  );
  // Drawer keeps its historical exclusive counts; the salon filters may overlap.
  const tableCounts = React.useMemo(() => {
    const counts = countWaiterSalonTables(waiterTableRows);
    return { libre: counts.livres, ocupada: counts.ocupadas - counts.prontas, pronto: counts.prontas };
  }, [waiterTableRows]);

  const selectedTable = useMemo(
    () => isOperationalSnapshotReady ? salonTables.find(t => t.id === selectedTableId) : undefined,
    [isOperationalSnapshotReady, salonTables, selectedTableId],
  );
  const selectedTableOrders = useMemo(
    () => selectedTable ? orders.filter(o => o.mesaId === selectedTable.id) : [],
    [orders, selectedTable],
  );

  if (!isAuthenticated) {
    return (
      <OperationalLogin
        portal={portal}
        theme={theme}
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        isLoggingIn={isLoggingIn}
        restaurantOptions={loginRestaurantOptions}
        restaurantId={loginRestaurantId}
        onRestaurantChange={setLoginRestaurantId}
        onToggleTheme={toggleTheme}
        onUsernameChange={(value) => {
          setLoginUsername(value);
          setLoginRestaurantOptions([]);
          setLoginRestaurantId("");
        }}
        onPasswordChange={(value) => {
          setLoginPassword(value);
          setLoginRestaurantOptions([]);
          setLoginRestaurantId("");
        }}
        onSubmit={handleLoginSubmit}
      />
    );
  }

  if (!isOperationalSnapshotReady) {
    return (
      <div className={`min-h-screen w-full bg-koma-page text-koma-foreground flex flex-col font-sans ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''}`}>
        <SupportSessionBanner />
        <OperationalSnapshotLoading error={fetchError} />
      </div>
    );
  }

  if (isManagementRole(activeRole)) {
    return (
      <div className={`management-shell w-full bg-koma-page text-koma-foreground flex flex-col font-sans ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''}`}>
        <SupportSessionBanner />
        <React.Suspense fallback={<CashierLoading />}>
          <MemoizedCaixaPanel
            orders={orders}
            onRefreshOrders={fetchOrdersFromAPI}
            apiBaseUrl={API_BASE_URL}
            authHeaders={managementAuthHeaders}
            activeWaiterNome={activeWaiterNome}
            salonTables={salonTables}
            onCreateMesa={handleCreateMesa}
            onUpdateMesa={handleUpdateMesa}
            onDeleteMesa={handleDeleteMesa}
            pagamentosPendentes={pagamentosPendentes}
            onRefreshPagamentosPendentes={fetchPagamentosPendentes}
            isWsConnected={isWsConnected}
            turnoResumo={turnoResumo}
            isTurnoResumoLoading={isTurnoResumoLoading}
            onRefreshTurnoResumo={fetchTurnoResumo}
            liveProdutos={liveProdutos}
            liveCategorias={liveCategorias}
            catalogReady={isProductsLoaded}
            onRefreshCategorias={fetchLiveCatalog}
            restauranteConfig={restauranteConfig}
            fetchError={fetchError}
            onOptimisticUpdateItemStatus={handleOptimisticUpdateItemStatus}
            onOptimisticAddOrder={handleOptimisticAddOrder}
            onRemovePendingPaymentOptimistic={handleRemovePendingPaymentOptimistic}
          />
        </React.Suspense>
      </div>
    );
  }

  return (
    <div className={`waiter-shell min-h-screen bg-koma-page text-koma-foreground flex flex-col font-sans ${fontSize === 'grande' ? 'font-large' : fontSize === 'gigante' ? 'font-huge' : ''}`}>
      <SupportSessionBanner />
      {/* GLOBAL TOP HEADER */}
      <header className="bg-koma-page/95 backdrop-blur-xl border-b border-koma-border-subtle text-koma-foreground shrink-0 sticky top-0 z-30">
        <div className="max-w-[1680px] mx-auto px-3 sm:px-6 lg:px-10 py-3.5">
          <div className="flex justify-between items-center">

            {/* Left: Settings Button + Logo + Title */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                id="open-sidebar-btn"
                onClick={() => setIsSidebarOpen(true)}
                className="p-2.5 bg-white/[0.04] text-[#00b894] hover:bg-[#00b894] hover:text-black rounded-xl cursor-pointer border border-koma-border flex items-center justify-center transition-all"
                title="Operação & Configurações do Caixa"
              >
                <SlidersHorizontal size={18} />
              </button>

              <div className="flex items-center gap-2.5">
                <KomaLogo size="lg" />
                <div>
                  <h1 className="font-serif text-base sm:text-lg font-black tracking-[-0.03em] text-koma-foreground leading-tight">
                    {restaurantName}
                  </h1>
                  <p className="text-[9px] text-koma-muted font-sans leading-none mt-0.5 font-medium">
                    {activeWaiter.nome}
                  </p>
                </div>
              </div>
            </div>

            {/* Right: Network Status Badge */}
            <div className="flex items-center gap-2">

            </div>

          </div>
        </div>
      </header>

      {/* LATERAL DRAWER MENU */}
      {isSidebarOpen && (
        <OperationalDrawer
          portal={portal}
          restaurantName={restaurantName}
          activeWaiterName={activeWaiter.nome}
          waiterAvailable={waiterAvailable}
          orders={orders}
          tableCounts={tableCounts}
          turnoResumo={turnoResumo}
          settings={settings}
          theme={theme}
          onWaiterAvailabilityChange={setWaiterAvailable}
          onSettingsChange={setSettings}
          onToggleTheme={toggleTheme}
          onClose={() => setIsSidebarOpen(false)}
          onLogout={handleLogout}
          onSyncSalon={() => {
            fetchOrdersFromAPI();
            fetchTables();
          }}
        />
      )}

      {/* MAIN CONTAINER */}
      <main className="flex-1 max-w-[1680px] w-full mx-auto px-3 sm:px-6 lg:px-10 py-4 sm:py-7 space-y-4 sm:space-y-7">
        {activeRole === 'cozinha' ? (
          <KitchenPanel
            orders={orders}
            onFinishPreparation={handleFinishPreparation}
            currentTime={currentTime}
          />
        ) : isManagementRole(activeRole) ? (
          <React.Suspense fallback={<CashierLoading />}>
            <MemoizedCaixaPanel
              orders={orders}
              onRefreshOrders={fetchOrdersFromAPI}
              apiBaseUrl={API_BASE_URL}
              authHeaders={managementAuthHeaders}
              activeWaiterNome={activeWaiterNome}
              salonTables={salonTables}
              onCreateMesa={handleCreateMesa}
              onUpdateMesa={handleUpdateMesa}
              onDeleteMesa={handleDeleteMesa}
              pagamentosPendentes={pagamentosPendentes}
              onRefreshPagamentosPendentes={fetchPagamentosPendentes}
              isWsConnected={isWsConnected}
              turnoResumo={turnoResumo}
              isTurnoResumoLoading={isTurnoResumoLoading}
              onRefreshTurnoResumo={fetchTurnoResumo}
              liveProdutos={liveProdutos}
              liveCategorias={liveCategorias}
              catalogReady={isProductsLoaded}
              onRefreshCategorias={fetchLiveCatalog}
              restauranteConfig={restauranteConfig}
              fetchError={fetchError}
              onOptimisticUpdateItemStatus={handleOptimisticUpdateItemStatus}
              onOptimisticAddOrder={handleOptimisticAddOrder}
              onRemovePendingPaymentOptimistic={handleRemovePendingPaymentOptimistic}
            />
          </React.Suspense>
        ) : (
          /* VIEW 2: SALÃO (WAITERS OR CASHIER DASHBOARD) */
          <MesasView
            rows={waiterTableRows}
            salonTables={salonTables}
            orders={orders}
            draftItemsMap={drafts}
            activeDrafts={activeDrafts}
            pagamentosPendentes={pagamentosPendentes}
            activeWaiterId={activeWaiterId}
            currentTime={currentTime}
            onTableClick={handleTableClick}
            tableFilter={tableFilter}
            onFilterChange={setTableFilter}
            showOperationalStatus={isConfigLoaded && restauranteConfig?.perm_garcom_status !== false}
          />
        )}

      </main>

      {/* FOOTER */}
      <footer className={"bg-koma-page text-koma-muted border-t border-white/[0.06] py-4 text-center text-xs shrink-0 font-sans"}>
        <div className={"max-w-[1680px] mx-auto px-4 flex items-center justify-center gap-2"}>
          <p className={"font-serif text-sm text-emerald-700 dark:text-emerald-400 font-medium"}>{restaurantName}</p>
          <span className="h-1 w-1 rounded-full bg-zinc-700" />
          <p className="text-[10px]">Operação do salão</p>
        </div>
      </footer>

      {/* MODAL CONTROLLER */}
      {selectedTable && (() => {
        const selectedTableActiveClients = Array.from(new Set(
          selectedTableOrders.flatMap(order => {
            const arr = Array.isArray(order?.itens) ? order.itens : Array.isArray(order?.items) ? order.items : [];
            return arr
              .map(item => (item?.clienteNome || item?.cliente_nome || '').trim())
              .filter(name => name !== '' && name !== 'Consumo Geral');
          })
        ));

        // Concurrency: Waiters other than active editing drafts on this table (synced via WebSockets)
        const otherWaitersServing = Object.keys(activeDrafts[selectedTable.id] || {})
          .filter(gId => gId !== activeWaiterId)
          .map(gId => activeDrafts[selectedTable.id][gId].garcomNome);

        return (
          <MesaDetailsModal
            table={selectedTable}
            orders={selectedTableOrders}
            allOrders={orders}
            draftItems={getDraftItems(selectedTable.id)}
            isSubmitting={isSubmitting}
            otherWaitersServing={otherWaitersServing}
            salonTables={salonTables}
            settings={settings}
            activeRole={activeRole}
            activeWaiterId={activeWaiterId}
            activeWaiterNome={activeWaiter.nome}
            currentTime={currentTime}
            onClose={() => setSelectedTableId(null)}
            onUpdateSettings={setSettings}
            onAddToDraft={(product, qty, obs, client) => handleAddToDraft(selectedTable.id, product, qty, obs, client)}
            onRemoveFromDraft={(draftItemId) => handleRemoveFromDraft(selectedTable.id, draftItemId)}
            onUpdateDraftItem={(draftItemId, fields) => handleUpdateDraftItem(selectedTable.id, draftItemId, fields)}
            onEditDraftItems={(draftItemIds, fields) => handleEditDraftItems(selectedTable.id, draftItemIds, fields)}
            onSubmitDraft={(orderType) => handleSubmitDraft(selectedTable.id, orderType)}
            onTransferTable={(targetTableId) => handleTransferTable(selectedTable.id, targetTableId)}
            onTransferItem={handleTransferItem}
            onTransferItems={handleTransferItems}
            onCancelItem={handleCancelItem}
            onCloseTable={() => handleCloseTable(selectedTable.id)}
            onSettleCustomer={(customerName) => handleSettleCustomer(selectedTable.id, customerName)}
            onDeliverItem={handleDeliverItem}
            historicClients={selectedTableActiveClients}
            restaurantName={restaurantName}
            onClearTableOrders={() => handleClearTableOrders(selectedTable.id)}
            onPrintReceipt={(apenasValores) => handlePrintReceipt(selectedTable.id, apenasValores)}
            onPrintKitchenLaunch={handlePrintKitchenLaunch}
            liveProdutos={liveProdutos}
            liveCategorias={liveCategorias}
            catalogReady={isProductsLoaded}
            restauranteConfig={restauranteConfig}
            onUpdateItemDetails={handleUpdateItemDetails}
            onMergeTables={handleMergeTables}
            onUnmergeTable={handleUnmergeTable}
          />
        );
      })()}

    </div>
  );
}
