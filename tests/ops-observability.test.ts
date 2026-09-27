import test from "node:test";
import assert from "node:assert/strict";
import { nextMonitorState, previousRunState, reconcileMonitor } from "../scripts/ops-monitor.mjs";
import { parseTraceLines } from "../scripts/ops-trace.mjs";
import { diagnose } from "../scripts/ops-doctor.mjs";

test("support code is a searchable request ID prefix", async () => {
  Object.assign(globalThis, { window: { location: { hostname: "localhost", protocol: "http:", href: "http://localhost:3000/" } } });
  const { supportCodeFromRequestId } = await import("../src/utils/supportCode");
  assert.equal(supportCodeFromRequestId("abcdef1234567890abcdef1234567890"), "abcdef123456");
  assert.equal(supportCodeFromRequestId("h3o-check-123"), "h3o-check-12");
  assert.equal(supportCodeFromRequestId("secret token"), null);
});

test("frontend observes API 500 but ignores validation and external responses", async () => {
  const events: Array<{ code: string; requestId: string }> = [];
  const fakeWindow = {
    location: { hostname: "localhost", protocol: "http:", href: "http://localhost:3000/" },
    fetch: async (input: string) => new Response(null, {
      status: input.includes("validation") ? 422 : 500,
      headers: { "X-Request-ID": "abcdef1234567890abcdef1234567890" },
    }),
    dispatchEvent: (event: CustomEvent<{ code: string; requestId: string }>) => {
      events.push(event.detail); return true;
    },
  };
  Object.assign(globalThis, { window: fakeWindow });
  const { installSupportCodeObserver } = await import("../src/utils/supportCode");
  installSupportCodeObserver();
  await fakeWindow.fetch("http://localhost:8000/orders");
  await fakeWindow.fetch("http://localhost:8000/validation");
  await fakeWindow.fetch("https://example.com/error");
  assert.deepEqual(events, [{ code: "abcdef123456", requestId: "abcdef1234567890abcdef1234567890" }]);
});

test("monitor confirms failure, deduplicates issue, and confirms recovery", async () => {
  let state: any = {};
  const calls: string[] = [];
  const handlers = {
    createIssue: async () => { calls.push("create"); return 42; },
    updateIssue: async () => { calls.push("update"); },
    closeIssue: async () => { calls.push("close"); },
  };
  state = await reconcileMonitor({ previous: state, failures: ["503"], ...handlers });
  assert.equal(state.issue, null);
  state = await reconcileMonitor({ previous: state, failures: ["503"], ...handlers });
  state = await reconcileMonitor({ previous: state, failures: ["503"], ...handlers });
  state = await reconcileMonitor({ previous: state, failures: [], ...handlers });
  assert.equal(state.issue, 42);
  state = await reconcileMonitor({ previous: state, failures: [], ...handlers });
  assert.equal(state.issue, null);
  assert.deepEqual(calls, ["create", "update", "close"]);
  assert.deepEqual(nextMonitorState({ failures: 1, successes: 0 }, true).failures, 0);
  assert.deepEqual(previousRunState([{ id: 10, status: "in_progress" }, { id: 9, status: "completed", conclusion: "failure" }], 10, 42), { failures: 1, successes: 0, issue: 42 });
});

test("trace returns only matching structured events", () => {
  const lines = [
    JSON.stringify({ timestamp: "2026-09-27T00:00:00Z", message: JSON.stringify({ event: "http_exception", request_id: "abcdef1234567890", exception_type: "RuntimeError" }) }),
    JSON.stringify({ timestamp: "2026-09-27T00:00:01Z", message: "noise abcdef123456" }),
  ];
  assert.equal(parseTraceLines(lines, "abcdef123456").length, 1);
  assert.equal(parseTraceLines(lines, "00000000").length, 0);
});

test("doctor reports failed public checks with nonzero health", async () => {
  const result = await diagnose(async () => { throw new Error("controlled timeout"); });
  assert.equal(result.healthy, false);
  assert.equal(result.lines.filter(line => line.includes("FALHA")).length, 3);
});
