/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { supabase } from "./SupabaseClient";

export async function syncCustomerToSupabase(profile: {
  id?: string;
  name: string;
  phone: string;
  address?: string;
  restaurantId?: string | number;
}) {
  try {
    const cleanPhone = (profile.phone || "").replace(/\D/g, "");
    if (!cleanPhone) return;

    const customerId = profile.id || `cli-${cleanPhone}`;
    const record = {
      id: customerId,
      restaurante_id: Number(profile.restaurantId || 1),
      telefone: cleanPhone,
      nome: profile.name.trim(),
      endereco: profile.address?.trim() || "",
      saldo_pontos: 0,
      saldo_cashback: 0
    };

    // 1. Tenta buscar se o cliente já existe por telefone no Supabase
    const { data: existing } = await supabase
      .from("clientes")
      .select("id")
      .eq("telefone", cleanPhone)
      .limit(1);

    if (existing && existing.length > 0) {
      // Atualiza cliente existente usando o ID primário
      const { error } = await supabase
        .from("clientes")
        .update({
          nome: record.nome,
          endereco: record.endereco || undefined
        })
        .eq("id", existing[0].id);

      if (error) console.warn("Supabase update clientes notice:", error.message);
      else console.log("✅ Cliente atualizado com sucesso na tabela 'clientes' do Supabase!");
    } else {
      // Insere novo cliente usando primary key 'id'
      const { error } = await supabase.from("clientes").upsert(record, { onConflict: "id" });
      if (error) console.warn("Supabase insert clientes notice:", error.message);
      else console.log("✅ Novo cliente persistido com sucesso na tabela 'clientes' do Supabase!");
    }

    // Sincroniza localmente para garantir persistência offline-first
    try {
      const storedRaw = localStorage.getItem("koma_loyalty_clients_cache");
      let list: any[] = storedRaw ? JSON.parse(storedRaw) : [];
      const idx = list.findIndex(c => (c.telefone || "").replace(/\D/g, "") === cleanPhone);
      const updatedItem = {
        id: record.id,
        cliente: record.nome,
        telefone: cleanPhone,
        endereco: record.endereco,
        pontos: 0,
        saldo_pontos: 0,
        saldoCashback: 0,
        saldo_cashback: 0
      };
      if (idx >= 0) list[idx] = updatedItem;
      else list.unshift(updatedItem);
      localStorage.setItem("koma_loyalty_clients_cache", JSON.stringify(list));
    } catch (e) {
      console.warn("Erro ao salvar cache local de clientes:", e);
    }

    // Dispara evento em tempo real no frontend do Caixa
    window.dispatchEvent(new Event("koma_customers_updated"));
  } catch (err) {
    console.warn("Erro na sincronização de clientes:", err);
  }
}

export async function syncOrderToSupabase(orderData: {
  comandaId: string;
  numeroPedido: number | string;
  clienteNome: string;
  clienteTelefone: string;
  tipo: string;
  total: number;
  restaurantId?: string | number;
  itens?: any[];
}) {
  try {
    const cleanPhone = (orderData.clienteTelefone || "").replace(/\D/g, "");

    // Garante primeiro o cadastro do cliente na tabela 'clientes'
    await syncCustomerToSupabase({
      name: orderData.clienteNome,
      phone: cleanPhone,
      restaurantId: orderData.restaurantId
    });

    const comandaRecord = {
      id: String(orderData.comandaId),
      restaurante_id: Number(orderData.restaurantId || 1),
      numero_comanda: String(orderData.numeroPedido),
      cliente_nome: orderData.clienteNome,
      cliente_telefone: cleanPhone,
      tipo: orderData.tipo || "Delivery",
      status: "ABERTA",
      valor_total: orderData.total,
      itens: orderData.itens || []
    };

    // Grava na tabela real 'comandas' no Supabase usando chave primária 'id'
    const { error } = await supabase.from("comandas").upsert(comandaRecord, { onConflict: "id" });
    if (error) {
      console.warn("Supabase comandas upsert notice:", error.message);
    } else {
      console.log("✅ Pedido persistido com sucesso na tabela 'comandas' do Supabase!");
    }

    // Dispara eventos de atualização em tempo real
    window.dispatchEvent(new Event("koma_orders_updated"));
    window.dispatchEvent(new Event("koma_customers_updated"));
  } catch (err) {
    console.warn("Erro na sincronização de comandas:", err);
  }
}
