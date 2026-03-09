import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { setTimeout as sleep } from "node:timers/promises";
import { Window } from "happy-dom";

const windowInstance = new Window({ url: "https://example.test" });
const { document } = windowInstance;

const fetchCalls = [];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function mockFetch(input, init = {}) {
  const url = typeof input === "string" ? input : String(input.url);
  fetchCalls.push({ url, method: init.method ?? "GET", body: init.body ?? null });

  if (url.endsWith("/api/chat/sessions") && (init.method ?? "GET") === "POST") {
    return jsonResponse({
      uid: "sess_smoke_123",
      user_uid: null,
      anon_uid: "anon_smoke_123",
      device_uid: null,
      status: "active",
      last_activity: new Date().toISOString(),
      metadata_json: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  if (url.includes("/api/chat/sessions/") && url.includes("/messages")) {
    return jsonResponse([]);
  }

  if (url.endsWith("/api/chat") && (init.method ?? "GET") === "POST") {
    return jsonResponse({
      session_uid: "sess_smoke_123",
      message_uid: "msg_smoke_123",
      answer: "Smoke response OK",
      source: "project",
      confidence: 0.99,
      evidence: [],
      created_at: new Date().toISOString(),
    });
  }

  if (url.endsWith("/api/runtime/sessions/refresh") && (init.method ?? "GET") === "POST") {
    return jsonResponse({
      token: "runtime_smoke_token_2",
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      session_id: "sess_smoke_123",
      refresh_available_at: new Date().toISOString(),
    });
  }

  return jsonResponse({ detail: `Unhandled path in smoke: ${url}` }, 404);
}

globalThis.window = windowInstance;
globalThis.document = document;
globalThis.localStorage = windowInstance.localStorage;
globalThis.HTMLElement = windowInstance.HTMLElement;
globalThis.Node = windowInstance.Node;
globalThis.CustomEvent = windowInstance.CustomEvent;
globalThis.Event = windowInstance.Event;
globalThis.KeyboardEvent = windowInstance.KeyboardEvent;
globalThis.MutationObserver = windowInstance.MutationObserver;
globalThis.getComputedStyle = windowInstance.getComputedStyle.bind(windowInstance);
globalThis.fetch = mockFetch;

if (!globalThis.navigator) {
  globalThis.navigator = windowInstance.navigator;
}

const bundlePath = path.resolve(process.cwd(), "dist/pointerai-widget.js");
const bundleCode = await fs.readFile(bundlePath, "utf8");
vm.runInThisContext(bundleCode, { filename: bundlePath });

assert.ok(window.PointerAIWidget, "PointerAIWidget global is missing");
assert.equal(typeof window.PointerAIWidget.init, "function", "PointerAIWidget.init should exist");

const instance = await window.PointerAIWidget.init({
  apiBaseUrl: "https://api.example.test",
  projectId: "proj_smoke_123",
  publishableKey: "pk_smoke_123",
  openOnLoad: true,
  title: "Smoke Test Widget",
});

const host = document.querySelector('[data-pointerai-widget="true"]');
assert.ok(host, "Widget host element was not mounted");

const shadowRoot = host.shadowRoot;
assert.ok(shadowRoot, "Widget shadow root missing");

const input = shadowRoot.querySelector(".pa-input");
const sendButton = shadowRoot.querySelector(".pa-send");
assert.ok(input, "Input not found");
assert.ok(sendButton, "Send button not found");

input.value = "Smoke question";
sendButton.click();
await sleep(30);

await window.PointerAIWidget.sendMessage("Smoke question via runtime API");
await sleep(30);

const sessionCalls = fetchCalls.filter((call) => call.url.endsWith("/api/chat/sessions"));
const listMessageCalls = fetchCalls.filter((call) => call.url.includes("/messages"));
const chatCalls = fetchCalls.filter((call) => call.url.endsWith("/api/chat"));
assert.ok(sessionCalls.length >= 1, "Expected create-session call");
assert.ok(listMessageCalls.length >= 1, "Expected list-messages call");
assert.ok(chatCalls.length >= 2, "Expected chat call(s)");

const messagesText = shadowRoot.querySelector(".pa-messages")?.textContent ?? "";
assert.ok(messagesText.includes("Smoke response OK"), "Expected assistant smoke response in UI");

window.PointerAIWidget.destroy();
assert.equal(
  document.querySelector('[data-pointerai-widget="true"]'),
  null,
  "Widget host should be removed after destroy"
);

if (instance && typeof instance.destroy === "function") {
  // no-op: destroy already called through global API
}

console.log("pointerai-widget smoke PASS");
