/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL;
const supabasePublishableKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "[KÔMA] Configuração do Supabase incompleta. " +
    "Defina VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env antes de iniciar. " +
    "Consulte .env.example para orientação."
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey);
