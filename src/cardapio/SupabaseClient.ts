/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "https://tcmquksunj4cwwmjzxpisy.supabase.co";
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "dummy-anon-key-to-prevent-bootstrap-error";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
