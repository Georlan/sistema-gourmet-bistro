/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || "https://iiowhekvahxiepwcdidm.supabase.co";
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlpb3doZWt2YWh4aWVwd2NkaWRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0OTcwNDEsImV4cCI6MjA5OTA3MzA0MX0.AYKYcLZEv7Hm0mbe1WcDj9TYo1vFM4LgCVi9br_1QrA";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`
    }
  }
});
