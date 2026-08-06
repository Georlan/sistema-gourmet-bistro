/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lê as variáveis públicas do ambiente de build (VITE_*).
// Essas chaves são anon/publishable — públicas por design do Supabase.
// NUNCA coloque SUPABASE_SERVICE_ROLE_KEY ou sb_secret_... aqui.
const _url = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
const _key = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

// Lazy initialization: o módulo carrega sem travar o app.
// O cliente só é criado quando a primeira propriedade for acessada.
// Se as variáveis de ambiente não estiverem definidas, um erro claro é
// lançado SOMENTE ao tentar usar o Cardápio Digital, sem derrubar o PDV.
let _client: SupabaseClient | undefined;

function getClient(): SupabaseClient {
  if (_client) return _client;

  if (!_url || !_key) {
    throw new Error(
      "[KÔMA] Cardápio Digital indisponível: VITE_SUPABASE_URL e " +
      "VITE_SUPABASE_PUBLISHABLE_KEY não estão configurados. " +
      "Consulte .env.example e adicione as variáveis de ambiente " +
      "no Cloudflare Pages (Settings → Environment Variables)."
    );
  }

  _client = createClient(_url, _key);
  return _client;
}

// Proxy transpassa todas as chamadas para o cliente real (lazy).
// O restante do sistema (PDV, caixa, garçom) não é afetado.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof SupabaseClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
