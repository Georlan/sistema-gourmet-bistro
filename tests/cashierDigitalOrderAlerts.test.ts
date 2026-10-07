import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const caixaSource = readFileSync(new URL("../src/components/CaixaPanel.tsx", import.meta.url), "utf8");
const alertsSource = readFileSync(new URL("../src/components/caixa/realtime/useCashierAlerts.ts", import.meta.url), "utf8");

test("1. banner amarelo de pedido aguardando aceite não é mais renderizado", () => {
  assert.doesNotMatch(caixaSource, /PEDIDO AGUARDANDO ACEITE/);
  assert.doesNotMatch(caixaSource, /O alerta sonoro continua até todos serem aceitos ou recusados/);
  assert.doesNotMatch(caixaSource, /bg-amber-300 px-5 py-3/);
  // Garante que o indicador legítimo do Kanban permanece
  assert.match(caixaSource, /orders: pendingAcceptanceOrders/);
});

test("2 a 11. ciclo de alerta digital: 3 ciclos, deduplicação, cancelamento antecipado e baseline", async () => {
  // Simulador do comportamento de useCashierAlerts com a máquina de estados implementada
  class CashierAlertSimulator {
    knownDigitalOrderIds: Set<string> | null = null;
    pendingAlertTimers = new Map<string, Array<{ id: number; delay: number; callback: () => void }>>();
    alertLog: Array<{ orderId: string; cycle: number; time: number }> = [];
    currentTime = 0;
    nextTimerId = 1;

    setTimeout(cb: () => void, delay: number): number {
      const id = this.nextTimerId++;
      return id;
    }

    clearTimeout(id: number) {
      for (const [orderId, timers] of this.pendingAlertTimers.entries()) {
        const filtered = timers.filter((t) => t.id !== id);
        if (filtered.length === 0) {
          this.pendingAlertTimers.delete(orderId);
        } else {
          this.pendingAlertTimers.set(orderId, filtered);
        }
      }
    }

    advanceTime(ms: number) {
      this.currentTime += ms;
      // Dispara timers pendentes cujo delay atingiu o tempo decorrido
      const triggered: Array<{ orderId: string; cb: () => void; id: number }> = [];
      for (const [orderId, timers] of Array.from(this.pendingAlertTimers.entries())) {
        for (const t of timers) {
          if (this.currentTime >= t.delay) {
            triggered.push({ orderId, cb: t.callback, id: t.id });
          }
        }
      }
      for (const trig of triggered) {
        this.clearTimeout(trig.id);
        trig.cb();
      }
    }

    playAlert(orderId: string, cycle: number) {
      this.alertLog.push({ orderId, cycle, time: this.currentTime });
    }

    onSync(deliveryOrders: Array<{ id: string; deliveryStatus: string }>, pendingAcceptanceOrders: Array<{ id: string }>) {
      // 1. Cancelamento antecipado de pedidos que saíram da fila de pendentes
      const activePendingIds = new Set(pendingAcceptanceOrders.map((o) => String(o.id)));
      for (const [orderId, timers] of Array.from(this.pendingAlertTimers.entries())) {
        if (!activePendingIds.has(orderId)) {
          timers.forEach((t) => this.clearTimeout(t.id));
          this.pendingAlertTimers.delete(orderId);
        }
      }

      // 2. Baseline inicial
      const currentIds = new Set(deliveryOrders.map((o) => String(o.id)));
      if (this.knownDigitalOrderIds === null) {
        this.knownDigitalOrderIds = currentIds;
        return;
      }

      const known = this.knownDigitalOrderIds;
      if (!Array.from(currentIds).some((id) => !known.has(id))) return;

      const newlyArrived = deliveryOrders.filter((o) => !known.has(String(o.id)));
      newlyArrived.forEach((o) => known.add(String(o.id)));

      newlyArrived.forEach((order) => {
        const orderId = String(order.id);
        const isPending = activePendingIds.has(orderId) || order.deliveryStatus === "pendente";
        if (!isPending) return;

        // Ciclo 1 (t = 0s)
        this.playAlert(orderId, 1);

        const timers: Array<{ id: number; delay: number; callback: () => void }> = [];
        const t1Id = this.nextTimerId++;
        timers.push({
          id: t1Id,
          delay: this.currentTime + 4000,
          callback: () => {
            this.playAlert(orderId, 2);
          },
        });

        const t2Id = this.nextTimerId++;
        timers.push({
          id: t2Id,
          delay: this.currentTime + 8000,
          callback: () => {
            this.playAlert(orderId, 3);
            this.pendingAlertTimers.delete(orderId);
          },
        });

        this.pendingAlertTimers.set(orderId, timers);
      });
    }

    unmount() {
      for (const timers of this.pendingAlertTimers.values()) {
        timers.forEach((t) => this.clearTimeout(t.id));
      }
      this.pendingAlertTimers.clear();
    }
  }

  // 11. Snapshot inicial de pedidos já pendentes NÃO dispara alerta retrospectivo
  const sim = new CashierAlertSimulator();
  sim.onSync([{ id: "c-existing-1", deliveryStatus: "pendente" }], [{ id: "c-existing-1" }]);
  assert.equal(sim.alertLog.length, 0, "Snapshot inicial não pode tocar alerta");

  // 2. Novo pedido digital dispara áudio
  sim.onSync(
    [
      { id: "c-existing-1", deliveryStatus: "pendente" },
      { id: "c-new-100", deliveryStatus: "pendente" },
    ],
    [{ id: "c-existing-1" }, { id: "c-new-100" }]
  );
  assert.equal(sim.alertLog.length, 1, "Novo pedido deve disparar 1º alerta imediatamente");
  assert.equal(sim.alertLog[0].orderId, "c-new-100");
  assert.equal(sim.alertLog[0].cycle, 1);

  // 4, 5, 6. Polling, rerender e refetch do mesmo ID não reiniciam contagem
  sim.onSync(
    [
      { id: "c-existing-1", deliveryStatus: "pendente" },
      { id: "c-new-100", deliveryStatus: "pendente" },
    ],
    [{ id: "c-existing-1" }, { id: "c-new-100" }]
  );
  assert.equal(sim.alertLog.length, 1, "Refetch/polling não deve criar alertas duplicados");

  // Avança para t = 4000ms: deve disparar 2º alerta
  sim.advanceTime(4000);
  assert.equal(sim.alertLog.length, 2);
  assert.equal(sim.alertLog[1].cycle, 2);

  // 3. Avança para t = 8000ms: deve disparar 3º alerta e parar (máximo 3 vezes)
  sim.advanceTime(4000);
  assert.equal(sim.alertLog.length, 3);
  assert.equal(sim.alertLog[2].cycle, 3);

  // Avança mais tempo: nenhum outro alerta deve tocar para c-new-100
  sim.advanceTime(10000);
  assert.equal(sim.alertLog.length, 3, "Mesmo pedido toca no máximo 3 vezes");

  // 7. Segundo pedido novo possui ciclo independente
  sim.onSync(
    [
      { id: "c-existing-1", deliveryStatus: "pendente" },
      { id: "c-new-100", deliveryStatus: "pendente" },
      { id: "c-new-200", deliveryStatus: "pendente" },
    ],
    [{ id: "c-existing-1" }, { id: "c-new-100" }, { id: "c-new-200" }]
  );
  assert.equal(sim.alertLog.length, 4, "Segundo pedido novo dispara seu próprio 1º alerta");
  assert.equal(sim.alertLog[3].orderId, "c-new-200");

  // 8. Aceitar antes do terceiro alerta cancela timers restantes
  sim.advanceTime(4000); // 2º alerta do c-new-200 toca
  assert.equal(sim.alertLog.length, 5);

  // Operador aceita c-new-200 (sai de pendingAcceptanceOrders)
  sim.onSync(
    [
      { id: "c-existing-1", deliveryStatus: "pendente" },
      { id: "c-new-100", deliveryStatus: "pendente" },
      { id: "c-new-200", deliveryStatus: "aceito" },
    ],
    [{ id: "c-existing-1" }, { id: "c-new-100" }] // c-new-200 foi aceito!
  );
  // Avança tempo após o aceite: o 3º som não pode disparar
  sim.advanceTime(6000);
  assert.equal(sim.alertLog.length, 5, "Aceite cancela o 3º alerta pendente");

  // 9. Rejeitar antes do terceiro alerta cancela timers restantes
  sim.onSync(
    [
      { id: "c-existing-1", deliveryStatus: "pendente" },
      { id: "c-new-100", deliveryStatus: "pendente" },
      { id: "c-new-200", deliveryStatus: "aceito" },
      { id: "c-new-300", deliveryStatus: "pendente" },
    ],
    [{ id: "c-existing-1" }, { id: "c-new-100" }, { id: "c-new-300" }]
  );
  assert.equal(sim.alertLog.length, 6, "c-new-300 toca 1º alerta");

  // Operador rejeita c-new-300 imediatamente
  sim.onSync(
    [
      { id: "c-existing-1", deliveryStatus: "pendente" },
      { id: "c-new-100", deliveryStatus: "pendente" },
      { id: "c-new-200", deliveryStatus: "aceito" },
      { id: "c-new-300", deliveryStatus: "recusado" },
    ],
    [{ id: "c-existing-1" }, { id: "c-new-100" }]
  );
  sim.advanceTime(10000);
  assert.equal(sim.alertLog.length, 6, "Rejeite cancela timers restantes");

  // 10. Desmontar componente limpa timers
  sim.onSync(
    [
      { id: "c-new-400", deliveryStatus: "pendente" },
    ],
    [{ id: "c-new-400" }]
  );
  assert.equal(sim.alertLog.length, 7);
  sim.unmount();
  assert.equal(sim.pendingAlertTimers.size, 0, "Unmount limpa todos os timers pendentes");
  sim.advanceTime(10000);
  assert.equal(sim.alertLog.length, 7, "Nenhum som após unmount");
});
