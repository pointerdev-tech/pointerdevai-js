"use strict";
(() => {
  // ../ai-chat-client/index.js
  var PointerAIError = class extends Error {
    /**
     * @param {string} message
     * @param {number} status
     * @param {unknown} data
     */
    constructor(message, status, data) {
      super(message);
      this.name = "PointerAIError";
      this.status = status;
      this.data = data;
    }
  };
  function createAnonUid(prefix = "anon") {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}`;
  }
  var PointerAIClient = class {
    /**
     * @param {PointerAIClientOptions} options
     */
    constructor(options) {
      if (!options || typeof options !== "object") {
        throw new Error("PointerAIClient options are required.");
      }
      if (!options.baseUrl || !String(options.baseUrl).trim()) {
        throw new Error("baseUrl is required.");
      }
      if (!options.projectId || !String(options.projectId).trim()) {
        throw new Error("projectId is required.");
      }
      if (!options.publishableKey || !String(options.publishableKey).trim()) {
        throw new Error("publishableKey is required.");
      }
      const providedFetch = options.fetch;
      const globalFetch = globalThis.fetch;
      if (typeof providedFetch !== "function" && typeof globalFetch !== "function") {
        throw new Error("No fetch implementation found. Pass options.fetch in Node environments.");
      }
      this.baseUrl = String(options.baseUrl).trim().replace(/\/+$/, "");
      this.projectId = String(options.projectId).trim();
      this.publishableKey = String(options.publishableKey).trim();
      this.endUserToken = options.endUserToken ? String(options.endUserToken).trim() : null;
      this.sessionToken = null;
      this.sessionExpiresAt = null;
      this.sessionRefreshAvailableAt = null;
      this.sessionId = null;
      if (typeof providedFetch === "function") {
        this.fetchImpl = (input, init2) => providedFetch(input, init2);
      } else {
        this.fetchImpl = globalFetch.bind(globalThis);
      }
    }
    /**
     * Set or replace active end-user token.
     * @param {string | null | undefined} token
     */
    setEndUserToken(token) {
      this.endUserToken = token ? String(token).trim() : null;
    }
    /**
     * Clear end-user token.
     */
    clearEndUserToken() {
      this.endUserToken = null;
    }
    /**
     * Set or replace active session token and metadata.
     * @param {string | null | undefined} token
     * @param {{expiresAt?: string | null, refreshAvailableAt?: string | null, sessionId?: string | null}} [meta]
     */
    setSessionToken(token, meta = {}) {
      this.sessionToken = token ? String(token).trim() : null;
      this.sessionExpiresAt = meta.expiresAt ? String(meta.expiresAt) : null;
      this.sessionRefreshAvailableAt = meta.refreshAvailableAt ? String(meta.refreshAvailableAt) : null;
      this.sessionId = meta.sessionId ? String(meta.sessionId) : null;
    }
    /**
     * Clear active session token and metadata.
     */
    clearSessionToken() {
      this.sessionToken = null;
      this.sessionExpiresAt = null;
      this.sessionRefreshAvailableAt = null;
      this.sessionId = null;
    }
    /**
     * Get currently tracked session token state.
     * @returns {{token: string | null, expiresAt: string | null, refreshAvailableAt: string | null, sessionId: string | null}}
     */
    getSessionTokenState() {
      return {
        token: this.sessionToken,
        expiresAt: this.sessionExpiresAt,
        refreshAvailableAt: this.sessionRefreshAvailableAt,
        sessionId: this.sessionId
      };
    }
    /**
     * Exchange end-user token for short-lived runtime session token.
     * @param {{ endUserToken?: string | null; sessionId?: string | null }} [options]
     * @returns {Promise<{token: string; expires_at: string; session_id: string | null; refresh_available_at: string}>}
     */
    async exchangeSessionToken(options = {}) {
      const tokenCandidate = typeof options.endUserToken === "string" && options.endUserToken.trim() ? options.endUserToken.trim() : this.endUserToken;
      if (!tokenCandidate) {
        throw new Error("endUserToken is required to exchange a runtime session token.");
      }
      const body = {};
      if (options.sessionId) {
        body.session_id = String(options.sessionId).trim();
      }
      const response = await this.request("/api/runtime/sessions", {
        method: "POST",
        body,
        endUserToken: tokenCandidate,
        authMode: "end-user",
        retryOnAuthFailure: false
      });
      this._applySessionTokenResponse(response);
      return response;
    }
    /**
     * Refresh a runtime session token.
     * @param {{ token?: string | null; persist?: boolean }} [options]
     * @returns {Promise<{token: string; expires_at: string; session_id: string | null; refresh_available_at: string}>}
     */
    async refreshSessionToken(options = {}) {
      const tokenCandidate = typeof options.token === "string" && options.token.trim() ? options.token.trim() : this.sessionToken;
      if (!tokenCandidate) {
        throw new Error("No session token available for refresh.");
      }
      const response = await this.request("/api/runtime/sessions/refresh", {
        method: "POST",
        body: { token: tokenCandidate },
        authMode: "none",
        retryOnAuthFailure: false
      });
      if (options.persist !== false) {
        this._applySessionTokenResponse(response);
      }
      return response;
    }
    /**
     * Revoke current runtime session token.
     * @param {{ token?: string | null; clearSession?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async revokeSessionToken(options = {}) {
      const tokenCandidate = typeof options.token === "string" && options.token.trim() ? options.token.trim() : this.sessionToken;
      if (!tokenCandidate) {
        return;
      }
      await this.request("/api/runtime/sessions/revoke", {
        method: "POST",
        body: { token: tokenCandidate },
        authMode: "none",
        allowEmpty: true,
        retryOnAuthFailure: false
      });
      const shouldClear = options.clearSession !== false;
      if (shouldClear && (!options.token || tokenCandidate === this.sessionToken)) {
        this.clearSessionToken();
      }
    }
    /**
     * Internal request helper.
     * @template T
     * @param {string} path
     * @param {RequestOptions} [options]
     * @returns {Promise<T>}
     */
    async request(path, options = {}) {
      const firstAttempt = await this._performRequest(path, options);
      let attempt = firstAttempt;
      if (this._shouldRefreshAndRetry(path, options, firstAttempt.tokenSource, firstAttempt.response.status)) {
        const refreshToken = this._trimOrNull(options.sessionToken) || this.sessionToken;
        if (refreshToken) {
          try {
            await this.refreshSessionToken({ token: refreshToken });
            const retryOptions = { ...options, retryOnAuthFailure: false };
            if ("sessionToken" in retryOptions) {
              delete retryOptions.sessionToken;
            }
            attempt = await this._performRequest(path, retryOptions);
          } catch {
            attempt = firstAttempt;
          }
        }
      }
      return this._parseAttemptResult(attempt, !!options.allowEmpty);
    }
    /**
     * Create a chat session.
     * - Anonymous mode: pass anonUid
     * - User mode: active session token or end-user token
     * @param {{ anonUid?: string; metadata?: Record<string, unknown>; endUserToken?: string | null }} [options]
     * @returns {Promise<{uid: string; user_uid: string | null; anon_uid: string | null; device_uid: string | null; status: string; last_activity: string; metadata_json: Record<string, unknown> | null; created_at: string; updated_at: string}>}
     */
    async createSession(options = {}) {
      const body = {
        metadata: options.metadata || {}
      };
      if (options.anonUid) {
        body.anon_uid = options.anonUid;
      }
      return this.request("/api/chat/sessions", {
        method: "POST",
        body,
        endUserToken: options.endUserToken
      });
    }
    /**
     * List sessions for anonymous user identity.
     * @param {string} anonUid
     * @param {{ limit?: number; endUserToken?: string | null }} [options]
     * @returns {Promise<Array<{uid: string; user_uid: string | null; anon_uid: string | null; device_uid: string | null; status: string; last_activity: string; metadata_json: Record<string, unknown> | null; created_at: string; updated_at: string}>>}
     */
    async listSessionsByAnon(anonUid, options = {}) {
      if (!anonUid || !String(anonUid).trim()) {
        throw new Error("anonUid is required.");
      }
      const limit = Number.isFinite(options.limit) ? Number(options.limit) : 50;
      return this.request(
        `/api/chat/sessions/by-anon?anon_uid=${encodeURIComponent(String(anonUid).trim())}&limit=${encodeURIComponent(String(limit))}`,
        {
          method: "GET",
          endUserToken: options.endUserToken
        }
      );
    }
    /**
     * List sessions for authenticated end-user.
     * @param {{ limit?: number; endUserToken?: string | null }} [options]
     * @returns {Promise<Array<{uid: string; user_uid: string | null; anon_uid: string | null; device_uid: string | null; status: string; last_activity: string; metadata_json: Record<string, unknown> | null; created_at: string; updated_at: string}>>}
     */
    async listSessionsByUser(options = {}) {
      const limit = Number.isFinite(options.limit) ? Number(options.limit) : 50;
      return this.request(`/api/chat/sessions/by-user?limit=${encodeURIComponent(String(limit))}`, {
        method: "GET",
        endUserToken: options.endUserToken
      });
    }
    /**
     * List messages in a session.
     * @param {string} sessionUid
     * @param {{ limit?: number; endUserToken?: string | null }} [options]
     * @returns {Promise<Array<{uid: string; session_uid: string; speaker: string; content: string; metadata_json: Record<string, unknown> | null; created_at: string}>>}
     */
    async listMessages(sessionUid, options = {}) {
      if (!sessionUid || !String(sessionUid).trim()) {
        throw new Error("sessionUid is required.");
      }
      const limit = Number.isFinite(options.limit) ? Number(options.limit) : 200;
      return this.request(
        `/api/chat/sessions/${encodeURIComponent(String(sessionUid).trim())}/messages?limit=${encodeURIComponent(String(limit))}`,
        {
          method: "GET",
          endUserToken: options.endUserToken
        }
      );
    }
    /**
     * Send a chat message.
     * @param {{
     *   message: string;
     *   sessionUid?: string;
     *   anonUid?: string;
     *   metadata?: Record<string, unknown>;
     *   endUserToken?: string | null;
     * }} payload
     * @returns {Promise<{session_uid: string; message_uid: string | null; answer: string; source: string; confidence: number; evidence: Array<{text: string; source_doc: string; score: number}>; created_at: string}>}
     */
    async chat(payload) {
      if (!payload || typeof payload !== "object") {
        throw new Error("chat payload is required.");
      }
      const message = payload.message ? String(payload.message).trim() : "";
      if (!message) {
        throw new Error("message is required.");
      }
      const body = {
        message,
        metadata: payload.metadata || {}
      };
      if (payload.sessionUid) {
        body.session_uid = String(payload.sessionUid).trim();
      }
      if (payload.anonUid) {
        body.anon_uid = String(payload.anonUid).trim();
      }
      return this.request("/api/chat", {
        method: "POST",
        body,
        endUserToken: payload.endUserToken
      });
    }
    /**
     * @param {{token: string; expires_at?: string; refresh_available_at?: string; session_id?: string | null}} response
     * @returns {void}
     */
    _applySessionTokenResponse(response) {
      this.setSessionToken(response.token, {
        expiresAt: response.expires_at || null,
        refreshAvailableAt: response.refresh_available_at || null,
        sessionId: response.session_id || null
      });
    }
    /**
     * @param {string} path
     * @param {RequestOptions} options
     * @returns {Promise<{response: Response, rawText: string, parsed: unknown, tokenSource: 'none' | 'session' | 'end-user'}>}
     */
    async _performRequest(path, options) {
      const method = options.method || "GET";
      const { headers, tokenSource } = this._buildHeaders(method, options);
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: method === "GET" ? void 0 : JSON.stringify(options.body || {})
      });
      const rawText = await response.text();
      let parsed = null;
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = null;
        }
      }
      return { response, rawText, parsed, tokenSource };
    }
    /**
     * @param {'GET' | 'POST'} method
     * @param {RequestOptions} options
     * @returns {{headers: Record<string, string>, tokenSource: 'none' | 'session' | 'end-user'}}
     */
    _buildHeaders(method, options) {
      const headers = {
        "X-Project-Id": this.projectId,
        "X-Project-Key": this.publishableKey
      };
      const { token, source } = this._resolveAuthToken(options);
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (method !== "GET") {
        headers["Content-Type"] = "application/json";
      }
      return { headers, tokenSource: source };
    }
    /**
     * @param {RequestOptions} options
     * @returns {{token: string | null, source: 'none' | 'session' | 'end-user'}}
     */
    _resolveAuthToken(options) {
      const mode = options.authMode || "auto";
      const sessionToken = "sessionToken" in options ? this._trimOrNull(options.sessionToken) : this.sessionToken;
      const endUserToken = "endUserToken" in options ? this._trimOrNull(options.endUserToken) : this.endUserToken;
      if (mode === "none") {
        return { token: null, source: "none" };
      }
      if (mode === "session") {
        return sessionToken ? { token: sessionToken, source: "session" } : { token: null, source: "none" };
      }
      if (mode === "end-user") {
        return endUserToken ? { token: endUserToken, source: "end-user" } : { token: null, source: "none" };
      }
      if (sessionToken) {
        return { token: sessionToken, source: "session" };
      }
      if (endUserToken) {
        return { token: endUserToken, source: "end-user" };
      }
      return { token: null, source: "none" };
    }
    /**
     * @param {{response: Response, rawText: string, parsed: unknown}} attempt
     * @param {boolean} allowEmpty
     * @returns {unknown}
     */
    _parseAttemptResult(attempt, allowEmpty) {
      const { response, rawText, parsed } = attempt;
      if (!response.ok) {
        let detail = null;
        if (parsed && typeof parsed === "object" && "detail" in parsed) {
          detail = parsed.detail;
        }
        throw new PointerAIError(
          this._formatErrorDetail(detail, rawText, response.status, response.statusText),
          response.status,
          parsed
        );
      }
      if (!rawText && allowEmpty) {
        return void 0;
      }
      if (!parsed) {
        throw new PointerAIError("Unexpected response format: expected JSON.", response.status, rawText);
      }
      return parsed;
    }
    /**
     * @param {string} path
     * @param {RequestOptions} options
     * @param {'none' | 'session' | 'end-user'} tokenSource
     * @param {number} status
     * @returns {boolean}
     */
    _shouldRefreshAndRetry(path, options, tokenSource, status) {
      if (status !== 401) {
        return false;
      }
      if (options.retryOnAuthFailure === false) {
        return false;
      }
      if (tokenSource !== "session") {
        return false;
      }
      if (path === "/api/runtime/sessions/refresh" || path === "/api/runtime/sessions/revoke") {
        return false;
      }
      return !!(this._trimOrNull(options.sessionToken) || this.sessionToken);
    }
    /**
     * @param {unknown} detail
     * @param {string} rawText
     * @param {number} status
     * @param {string} statusText
     * @returns {string}
     */
    _formatErrorDetail(detail, rawText, status, statusText) {
      if (typeof detail === "string" && detail.trim()) {
        return detail;
      }
      if (detail !== null && detail !== void 0) {
        try {
          return JSON.stringify(detail);
        } catch {
          return String(detail);
        }
      }
      if (rawText) {
        return rawText;
      }
      return `Request failed: ${status} ${statusText}`;
    }
    /**
     * @param {string | null | undefined} value
     * @returns {string | null}
     */
    _trimOrNull(value) {
      if (typeof value !== "string") {
        return null;
      }
      const trimmed = value.trim();
      return trimmed || null;
    }
  };

  // src/widget.ts
  var DEFAULTS = {
    title: "PointerAI Assistant",
    subtitle: "Ask about your project's indexed docs",
    launcherLabel: "Chat",
    launcherIcon: "AI",
    welcomeMessage: "Hi. Ask a question and I will answer from your indexed documentation.",
    placeholder: "Type your question...",
    sendLabel: "Send",
    themeColor: "#0f766e",
    panelBackgroundColor: "#ffffff",
    messagesBackgroundColor: "#f8fafc",
    textColor: "#111827",
    mutedTextColor: "#6b7280",
    panelBorderColor: "#e5e7eb",
    assistantBubbleColor: "#ffffff",
    assistantTextColor: "#111827",
    userBubbleColor: "#0f766e",
    userTextColor: "#ffffff",
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    borderRadius: 14,
    zIndex: 2147483e3,
    position: "right",
    sideOffset: 24,
    bottomOffset: 24,
    width: 360,
    maxHeight: 560,
    openOnLoad: false,
    historyFetchLimit: 100
  };
  var REFRESH_POLL_MS = 15e3;
  var REFRESH_LEEWAY_MS = 3e3;
  var MAX_STORED_MESSAGES = 120;
  function readJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
    }
  }
  function removeKey(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
    }
  }
  function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  function sanitizeConfig(config) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x;
    if (!((_a = config.apiBaseUrl) == null ? void 0 : _a.trim())) throw new Error("pointerai-widget: apiBaseUrl is required.");
    if (!((_b = config.projectId) == null ? void 0 : _b.trim())) throw new Error("pointerai-widget: projectId is required.");
    if (!((_c = config.publishableKey) == null ? void 0 : _c.trim())) throw new Error("pointerai-widget: publishableKey is required.");
    return {
      ...config,
      apiBaseUrl: config.apiBaseUrl.trim(),
      projectId: config.projectId.trim(),
      publishableKey: config.publishableKey.trim(),
      endUserToken: (_d = config.endUserToken) == null ? void 0 : _d.trim(),
      anonUid: (_e = config.anonUid) == null ? void 0 : _e.trim(),
      metadata: (_f = config.metadata) != null ? _f : {},
      title: (_g = config.title) != null ? _g : DEFAULTS.title,
      subtitle: (_h = config.subtitle) != null ? _h : DEFAULTS.subtitle,
      launcherLabel: (_i = config.launcherLabel) != null ? _i : DEFAULTS.launcherLabel,
      launcherIcon: (_j = config.launcherIcon) != null ? _j : DEFAULTS.launcherIcon,
      welcomeMessage: (_k = config.welcomeMessage) != null ? _k : DEFAULTS.welcomeMessage,
      placeholder: (_l = config.placeholder) != null ? _l : DEFAULTS.placeholder,
      sendLabel: (_m = config.sendLabel) != null ? _m : DEFAULTS.sendLabel,
      themeColor: (_n = config.themeColor) != null ? _n : DEFAULTS.themeColor,
      panelBackgroundColor: (_o = config.panelBackgroundColor) != null ? _o : DEFAULTS.panelBackgroundColor,
      messagesBackgroundColor: (_p = config.messagesBackgroundColor) != null ? _p : DEFAULTS.messagesBackgroundColor,
      textColor: (_q = config.textColor) != null ? _q : DEFAULTS.textColor,
      mutedTextColor: (_r = config.mutedTextColor) != null ? _r : DEFAULTS.mutedTextColor,
      panelBorderColor: (_s = config.panelBorderColor) != null ? _s : DEFAULTS.panelBorderColor,
      assistantBubbleColor: (_t = config.assistantBubbleColor) != null ? _t : DEFAULTS.assistantBubbleColor,
      assistantTextColor: (_u = config.assistantTextColor) != null ? _u : DEFAULTS.assistantTextColor,
      userBubbleColor: (_v = config.userBubbleColor) != null ? _v : DEFAULTS.userBubbleColor,
      userTextColor: (_w = config.userTextColor) != null ? _w : DEFAULTS.userTextColor,
      fontFamily: (_x = config.fontFamily) != null ? _x : DEFAULTS.fontFamily,
      borderRadius: toNumber(config.borderRadius, DEFAULTS.borderRadius),
      zIndex: toNumber(config.zIndex, DEFAULTS.zIndex),
      position: config.position === "left" ? "left" : "right",
      sideOffset: toNumber(config.sideOffset, DEFAULTS.sideOffset),
      bottomOffset: toNumber(config.bottomOffset, DEFAULTS.bottomOffset),
      width: toNumber(config.width, DEFAULTS.width),
      maxHeight: toNumber(config.maxHeight, DEFAULTS.maxHeight),
      openOnLoad: Boolean(config.openOnLoad),
      historyFetchLimit: Math.max(1, Math.min(200, Math.floor(toNumber(config.historyFetchLimit, DEFAULTS.historyFetchLimit)))),
      logoUrl: config.logoUrl,
      launcherIconUrl: config.launcherIconUrl
    };
  }
  var PointerAIWidgetInstance = class {
    constructor(rawConfig) {
      this.refreshTimer = null;
      this.bootPromise = null;
      this.typingEl = null;
      this.lastFailedMessage = null;
      this.isOpen = false;
      this.isSending = false;
      this.isBooting = false;
      this.isOffline = false;
      this.sessionUid = null;
      this.anonUid = null;
      this.messages = [];
      this.storageScope = "guest";
      this.onOnline = () => {
        this.isOffline = false;
        this.setStatus("Back online. Reconnecting...", "info", false);
        void this.recoverConnection();
      };
      this.onOffline = () => {
        this.isOffline = true;
        this.updateComposerState();
        this.setStatus("Offline. Waiting for connection...", "warn", false);
      };
      var _a, _b;
      this.config = sanitizeConfig(rawConfig);
      this.client = new PointerAIClient({
        baseUrl: this.config.apiBaseUrl,
        projectId: this.config.projectId,
        publishableKey: this.config.publishableKey,
        endUserToken: this.config.endUserToken
      });
      this.storageScope = this.deriveStorageScope((_a = this.client.endUserToken) != null ? _a : null, (_b = this.config.anonUid) != null ? _b : null);
      this.host = document.createElement("div");
      this.host.setAttribute("data-pointerai-widget", "true");
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.shadow.innerHTML = this.buildMarkup();
      const launcherEl = this.shadow.querySelector(".pa-launcher");
      const closeEl = this.shadow.querySelector(".pa-close");
      const panelEl = this.shadow.querySelector(".pa-panel");
      const messagesEl = this.shadow.querySelector(".pa-messages");
      const inputEl = this.shadow.querySelector(".pa-input");
      const sendEl = this.shadow.querySelector(".pa-send");
      const statusEl = this.shadow.querySelector(".pa-status");
      const statusTextEl = this.shadow.querySelector(".pa-status-text");
      const statusRetryEl = this.shadow.querySelector(".pa-status-retry");
      if (!launcherEl || !closeEl || !panelEl || !messagesEl || !inputEl || !sendEl || !statusEl || !statusTextEl || !statusRetryEl) {
        throw new Error("pointerai-widget: failed to initialize UI.");
      }
      this.launcherEl = launcherEl;
      this.closeEl = closeEl;
      this.panelEl = panelEl;
      this.messagesEl = messagesEl;
      this.inputEl = inputEl;
      this.sendEl = sendEl;
      this.statusEl = statusEl;
      this.statusTextEl = statusTextEl;
      this.statusRetryEl = statusRetryEl;
    }
    async mount() {
      document.body.appendChild(this.host);
      this.bindEvents();
      this.loadState();
      this.renderHistory();
      if (this.config.openOnLoad) this.setOpen(true);
      this.bootPromise = this.bootstrap();
      await this.bootPromise;
    }
    destroy() {
      if (this.refreshTimer !== null) {
        window.clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
      window.removeEventListener("online", this.onOnline);
      window.removeEventListener("offline", this.onOffline);
      this.host.remove();
    }
    async logout() {
      await this.client.revokeSessionToken({ clearSession: true });
      this.client.clearSessionToken();
      this.sessionUid = null;
      this.persistSessionUid(null);
    }
    open() {
      this.setOpen(true);
    }
    close() {
      this.setOpen(false);
    }
    async sendMessage(message) {
      await this.handleSend(message);
    }
    async setEndUserToken(token) {
      const nextToken = (token == null ? void 0 : token.trim()) || null;
      this.client.setEndUserToken(nextToken);
      this.rebindStorageScope(nextToken, this.anonUid);
      await this.recoverConnection();
    }
    async reconnect() {
      await this.recoverConnection();
    }
    bindEvents() {
      this.launcherEl.addEventListener("click", () => this.setOpen(!this.isOpen));
      this.closeEl.addEventListener("click", () => this.setOpen(false));
      this.sendEl.addEventListener("click", () => {
        void this.handleSend();
      });
      this.statusRetryEl.addEventListener("click", () => {
        void this.retryLastFailedMessage();
      });
      this.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void this.handleSend();
        }
        if (event.key === "Escape") {
          this.setOpen(false);
        }
      });
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
    async resolveEndUserToken() {
      var _a;
      const current = ((_a = this.client.endUserToken) == null ? void 0 : _a.trim()) || null;
      if (current) return current;
      const provider = this.config.getEndUserToken;
      if (typeof provider !== "function") return null;
      try {
        const provided = await provider();
        const token = typeof provided === "string" ? provided.trim() : "";
        if (!token) return null;
        this.client.setEndUserToken(token);
        this.rebindStorageScope(token, this.anonUid);
        return token;
      } catch {
        return null;
      }
    }
    async recoverConnection() {
      var _a;
      try {
        const endUserToken = await this.resolveEndUserToken();
        if (endUserToken) {
          await this.client.exchangeSessionToken({ sessionId: (_a = this.sessionUid) != null ? _a : void 0 });
        }
        await this.ensureSession();
        this.startRefreshTimer();
        this.setStatus("Connected.", "success", false);
        window.setTimeout(() => {
          if (!this.isSending && !this.isBooting) this.setStatus("", "info", false);
        }, 1200);
      } catch (error) {
        this.setStatus(this.renderError(error), "error", true);
      } finally {
        this.updateComposerState();
      }
    }
    async bootstrap() {
      var _a;
      this.isBooting = true;
      this.updateComposerState();
      this.setStatus("Connecting...", "info", false);
      try {
        const endUserToken = await this.resolveEndUserToken();
        if (endUserToken) {
          await this.client.exchangeSessionToken({ sessionId: (_a = this.sessionUid) != null ? _a : void 0 });
        } else if (!this.anonUid) {
          this.anonUid = createAnonUid("pa");
          this.rebindStorageScope(null, this.anonUid);
          this.persistAnonUid(this.anonUid);
        }
        await this.ensureSession();
        await this.syncHistoryFromServer();
        this.startRefreshTimer();
        this.setStatus("", "info", false);
      } catch (error) {
        this.setStatus(this.renderError(error), "error", true);
      } finally {
        this.isBooting = false;
        this.updateComposerState();
      }
    }
    async syncHistoryFromServer() {
      if (!this.sessionUid) return;
      try {
        const messages = await this.client.listMessages(this.sessionUid, {
          limit: this.config.historyFetchLimit
        });
        const mapped = messages.filter((item) => typeof item.content === "string" && item.content.trim() !== "").map((item) => ({
          role: item.speaker === "user" ? "user" : "assistant",
          content: item.content,
          createdAt: item.created_at
        })).sort((a, b) => {
          const aTs = Date.parse(a.createdAt);
          const bTs = Date.parse(b.createdAt);
          const aSafe = Number.isNaN(aTs) ? 0 : aTs;
          const bSafe = Number.isNaN(bTs) ? 0 : bTs;
          return aSafe - bSafe;
        });
        this.messages = mapped.slice(-MAX_STORED_MESSAGES);
        this.persistMessages();
        this.renderHistory();
      } catch {
      }
    }
    async ensureSession() {
      if (this.sessionUid) return;
      const payload = {
        metadata: this.buildMetadata()
      };
      if (this.anonUid) payload.anonUid = this.anonUid;
      const session = await this.client.createSession(payload);
      this.sessionUid = session.uid;
      this.persistSessionUid(this.sessionUid);
    }
    async handleSend(retryMessage) {
      var _a, _b, _c;
      const text = (retryMessage != null ? retryMessage : this.inputEl.value).trim();
      if (!text || this.isSending || this.isBooting || this.isOffline) return;
      if (this.bootPromise) {
        await this.bootPromise;
      }
      this.isSending = true;
      this.lastFailedMessage = null;
      this.inputEl.value = "";
      this.updateComposerState();
      this.setStatus("Thinking...", "info", false);
      this.addMessage("user", text, true);
      this.showTyping();
      try {
        await this.ensureSession();
        const response = await this.client.chat({
          message: text,
          sessionUid: (_a = this.sessionUid) != null ? _a : void 0,
          anonUid: (_b = this.anonUid) != null ? _b : void 0,
          metadata: this.buildMetadata()
        });
        this.sessionUid = (_c = response.session_uid) != null ? _c : this.sessionUid;
        this.persistSessionUid(this.sessionUid);
        this.hideTyping();
        this.addMessage("assistant", response.answer, true);
        this.setStatus("", "info", false);
      } catch (error) {
        this.hideTyping();
        this.lastFailedMessage = text;
        const message = this.renderError(error);
        this.addMessage("assistant", message, true);
        this.setStatus("Request failed. Retry available.", "error", true);
      } finally {
        this.isSending = false;
        this.updateComposerState();
        this.inputEl.focus();
      }
    }
    async retryLastFailedMessage() {
      if (!this.lastFailedMessage || this.isSending || this.isBooting) return;
      const retryText = this.lastFailedMessage;
      this.setStatus("Retrying...", "info", false);
      await this.handleSend(retryText);
    }
    startRefreshTimer() {
      if (this.refreshTimer !== null) {
        window.clearInterval(this.refreshTimer);
      }
      this.refreshTimer = window.setInterval(() => {
        void this.tryRefreshSessionToken();
      }, REFRESH_POLL_MS);
    }
    async tryRefreshSessionToken() {
      if (this.isOffline || this.isBooting) return;
      const state = this.client.getSessionTokenState();
      if (!state.token || !state.refreshAvailableAt) return;
      const refreshAt = Date.parse(state.refreshAvailableAt);
      if (Number.isNaN(refreshAt)) return;
      if (Date.now() < refreshAt - REFRESH_LEEWAY_MS) return;
      try {
        await this.client.refreshSessionToken({ persist: true });
      } catch {
      }
    }
    showTyping() {
      if (this.typingEl) return;
      const row = document.createElement("div");
      row.className = "pa-message pa-assistant pa-typing";
      row.innerHTML = '<span class="pa-dot"></span><span class="pa-dot"></span><span class="pa-dot"></span>';
      this.typingEl = row;
      this.messagesEl.appendChild(row);
      this.scrollToBottom();
    }
    hideTyping() {
      if (!this.typingEl) return;
      this.typingEl.remove();
      this.typingEl = null;
    }
    updateComposerState() {
      const disabled = this.isSending || this.isBooting || this.isOffline;
      this.sendEl.disabled = disabled;
      this.inputEl.disabled = disabled;
    }
    addMessage(role, content, persist) {
      const message = {
        role,
        content,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      this.messages.push(message);
      if (this.messages.length > MAX_STORED_MESSAGES) {
        this.messages = this.messages.slice(-MAX_STORED_MESSAGES);
      }
      this.renderMessage(message);
      if (persist) this.persistMessages();
    }
    renderHistory() {
      this.messagesEl.innerHTML = "";
      if (this.messages.length === 0) {
        this.addMessage("assistant", this.config.welcomeMessage, false);
        return;
      }
      for (const message of this.messages) {
        this.renderMessage(message);
      }
      this.scrollToBottom();
    }
    renderMessage(message) {
      const row = document.createElement("div");
      row.className = `pa-message pa-${message.role}`;
      row.textContent = message.content;
      this.messagesEl.appendChild(row);
      this.scrollToBottom();
    }
    setOpen(value) {
      this.isOpen = value;
      this.panelEl.classList.toggle("open", value);
      if (value) this.inputEl.focus();
    }
    setStatus(message, tone, showRetry) {
      this.statusEl.dataset.tone = tone;
      this.statusTextEl.textContent = message;
      this.statusRetryEl.style.display = showRetry ? "inline-flex" : "none";
    }
    scrollToBottom() {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
    loadState() {
      var _a, _b, _c;
      if (!this.isStorageEnabled()) {
        this.sessionUid = null;
        this.anonUid = (_a = this.config.anonUid) != null ? _a : null;
        this.messages = [];
        return;
      }
      this.sessionUid = readJson(this.storageKey("session_uid"));
      this.anonUid = (_b = this.config.anonUid) != null ? _b : readJson(this.storageKey("anon_uid"));
      this.messages = (_c = readJson(this.storageKey("messages"))) != null ? _c : [];
    }
    persistAnonUid(value) {
      if (!this.isStorageEnabled()) return;
      if (value) writeJson(this.storageKey("anon_uid"), value);
      else removeKey(this.storageKey("anon_uid"));
    }
    persistSessionUid(value) {
      if (!this.isStorageEnabled()) return;
      if (value) writeJson(this.storageKey("session_uid"), value);
      else removeKey(this.storageKey("session_uid"));
    }
    persistMessages() {
      if (!this.isStorageEnabled()) return;
      writeJson(this.storageKey("messages"), this.messages);
    }
    storageKey(name) {
      return `pointerai_widget:${this.config.projectId}:${this.storageScope}:${name}`;
    }
    isStorageEnabled() {
      return this.storageScope !== "pending-auth";
    }
    rebindStorageScope(endUserToken, anonUid) {
      const nextScope = this.deriveStorageScope(endUserToken, anonUid);
      if (nextScope === this.storageScope) {
        return;
      }
      this.storageScope = nextScope;
      this.loadState();
      this.renderHistory();
    }
    deriveStorageScope(endUserToken, anonUid) {
      const token = (endUserToken == null ? void 0 : endUserToken.trim()) || null;
      if (token) {
        const subject = this.extractJwtSubject(token);
        if (subject) {
          return `user:${this.normalizeStorageScopePart(subject)}`;
        }
        return `token:${this.hashString(token)}`;
      }
      if (typeof this.config.getEndUserToken === "function") {
        return "pending-auth";
      }
      const anon = (anonUid == null ? void 0 : anonUid.trim()) || null;
      if (anon) {
        return `anon:${this.normalizeStorageScopePart(anon)}`;
      }
      return "guest";
    }
    extractJwtSubject(token) {
      const parts = token.split(".");
      if (parts.length < 2) {
        return null;
      }
      const payload = parts[1];
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const pad = normalized.length % 4;
      const padded = pad > 0 ? normalized + "=".repeat(4 - pad) : normalized;
      try {
        const decoded = atob(padded);
        const parsed = JSON.parse(decoded);
        if (typeof parsed.sub === "string" && parsed.sub.trim() !== "") {
          return parsed.sub.trim();
        }
      } catch {
        return null;
      }
      return null;
    }
    normalizeStorageScopePart(value) {
      return value.toLowerCase().replace(/[^a-z0-9:_-]/g, "_").slice(0, 120);
    }
    hashString(value) {
      let hash = 2166136261;
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    }
    buildMetadata() {
      return {
        source: "pointerai-widget",
        ...this.config.metadata
      };
    }
    renderError(error) {
      var _a;
      if (error instanceof PointerAIError) {
        if (error.status === 401) {
          return "Authentication failed. Provide a valid end-user token for login-required projects.";
        }
        if (error.status === 403) {
          return "Access denied for this project or key.";
        }
        if (error.status === 409) {
          return "Project is not ready for chat. Upload and index documents first.";
        }
        const detail = (_a = error.data) == null ? void 0 : _a.detail;
        if (typeof detail === "string" && detail.trim()) {
          return detail;
        }
        return `Request failed (${error.status}).`;
      }
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return "Unexpected error. Please try again.";
    }
    escapeHtml(input) {
      return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }
    buildMarkup() {
      const side = this.config.position === "left" ? "left" : "right";
      const logoHtml = this.config.logoUrl ? `<img class="pa-logo" src="${this.escapeHtml(this.config.logoUrl)}" alt="logo" />` : "";
      const launcherIconHtml = this.config.launcherIconUrl ? `<img class="pa-launcher-icon-img" src="${this.escapeHtml(this.config.launcherIconUrl)}" alt="chat" />` : `<span class="pa-launcher-icon">${this.escapeHtml(this.config.launcherIcon)}</span>`;
      return `
<style>
  :host { all: initial; }
  .pa-root {
    --pa-theme-color: ${this.config.themeColor};
    --pa-panel-bg: ${this.config.panelBackgroundColor};
    --pa-messages-bg: ${this.config.messagesBackgroundColor};
    --pa-text: ${this.config.textColor};
    --pa-muted: ${this.config.mutedTextColor};
    --pa-border: ${this.config.panelBorderColor};
    --pa-assistant-bg: ${this.config.assistantBubbleColor};
    --pa-assistant-text: ${this.config.assistantTextColor};
    --pa-user-bg: ${this.config.userBubbleColor};
    --pa-user-text: ${this.config.userTextColor};

    font-family: ${this.config.fontFamily};
    position: fixed;
    ${side}: ${this.config.sideOffset}px;
    bottom: ${this.config.bottomOffset}px;
    z-index: ${this.config.zIndex};
    color: var(--pa-text);
  }
  .pa-launcher {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border: none;
    border-radius: 999px;
    padding: 10px 14px;
    color: #ffffff;
    background: var(--pa-theme-color);
    cursor: pointer;
    font-weight: 600;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
  }
  .pa-launcher-icon-img {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
  }
  .pa-panel {
    margin-top: 10px;
    width: ${this.config.width}px;
    max-width: min(92vw, ${this.config.width}px);
    height: min(82vh, ${this.config.maxHeight}px);
    display: none;
    flex-direction: column;
    border-radius: ${this.config.borderRadius}px;
    overflow: hidden;
    border: 1px solid var(--pa-border);
    background: var(--pa-panel-bg);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
  }
  .pa-panel.open {
    display: flex;
  }
  .pa-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid var(--pa-border);
    background: var(--pa-panel-bg);
  }
  .pa-header-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .pa-logo {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    object-fit: cover;
  }
  .pa-title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--pa-text);
  }
  .pa-subtitle {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--pa-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }
  .pa-close {
    border: 1px solid var(--pa-border);
    border-radius: 8px;
    background: #ffffff;
    color: var(--pa-muted);
    width: 28px;
    height: 28px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
  }
  .pa-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    background: var(--pa-messages-bg);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .pa-message {
    max-width: 85%;
    padding: 9px 11px;
    border-radius: 10px;
    font-size: 13px;
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .pa-user {
    align-self: flex-end;
    background: var(--pa-user-bg);
    color: var(--pa-user-text);
  }
  .pa-assistant {
    align-self: flex-start;
    background: var(--pa-assistant-bg);
    color: var(--pa-assistant-text);
    border: 1px solid var(--pa-border);
  }
  .pa-typing {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 44px;
  }
  .pa-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--pa-muted);
    animation: pa-bounce 1s infinite ease-in-out;
  }
  .pa-dot:nth-child(2) { animation-delay: .12s; }
  .pa-dot:nth-child(3) { animation-delay: .24s; }
  @keyframes pa-bounce {
    0%, 80%, 100% { transform: translateY(0); opacity: .45; }
    40% { transform: translateY(-3px); opacity: 1; }
  }
  .pa-status {
    min-height: 24px;
    font-size: 11px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 12px 0;
    color: var(--pa-muted);
  }
  .pa-status[data-tone="warn"] { color: #92400e; }
  .pa-status[data-tone="error"] { color: #b91c1c; }
  .pa-status[data-tone="success"] { color: #065f46; }
  .pa-status-retry {
    display: none;
    border: 1px solid var(--pa-border);
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 10px;
    background: #ffffff;
    color: var(--pa-text);
    cursor: pointer;
  }
  .pa-footer {
    padding: 10px;
    border-top: 1px solid var(--pa-border);
    background: var(--pa-panel-bg);
  }
  .pa-composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .pa-input {
    flex: 1;
    border: 1px solid var(--pa-border);
    border-radius: 10px;
    min-height: 40px;
    max-height: 120px;
    resize: vertical;
    padding: 9px 10px;
    font-size: 13px;
    color: var(--pa-text);
    box-sizing: border-box;
    outline: none;
    background: #ffffff;
  }
  .pa-input:focus {
    border-color: var(--pa-theme-color);
    box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.16);
  }
  .pa-send {
    border: none;
    border-radius: 10px;
    padding: 10px 12px;
    color: #ffffff;
    background: var(--pa-theme-color);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }
  .pa-send:disabled,
  .pa-input:disabled {
    opacity: 0.62;
    cursor: not-allowed;
  }
</style>
<div class="pa-root">
  <button class="pa-launcher" type="button">${launcherIconHtml}<span>${this.escapeHtml(this.config.launcherLabel)}</span></button>
  <div class="pa-panel">
    <div class="pa-header">
      <div class="pa-header-main">
        ${logoHtml}
        <div>
          <p class="pa-title">${this.escapeHtml(this.config.title)}</p>
          <p class="pa-subtitle">${this.escapeHtml(this.config.subtitle)}</p>
        </div>
      </div>
      <button class="pa-close" type="button" aria-label="Close chat">\xD7</button>
    </div>
    <div class="pa-messages"></div>
    <div class="pa-status" data-tone="info">
      <span class="pa-status-text"></span>
      <button class="pa-status-retry" type="button">Retry</button>
    </div>
    <div class="pa-footer">
      <div class="pa-composer">
        <textarea class="pa-input" aria-label="${this.escapeHtml(this.config.placeholder)}" placeholder="${this.escapeHtml(this.config.placeholder)}"></textarea>
        <button class="pa-send" type="button">${this.escapeHtml(this.config.sendLabel)}</button>
      </div>
    </div>
  </div>
</div>`;
    }
  };
  var activeInstance = null;
  async function init(config) {
    if (activeInstance) {
      activeInstance.destroy();
      activeInstance = null;
    }
    const instance = new PointerAIWidgetInstance(config);
    activeInstance = instance;
    await instance.mount();
    return instance;
  }
  function destroy() {
    if (!activeInstance) return;
    activeInstance.destroy();
    activeInstance = null;
  }
  function getInstance() {
    return activeInstance;
  }
  function open() {
    activeInstance == null ? void 0 : activeInstance.open();
  }
  function close() {
    activeInstance == null ? void 0 : activeInstance.close();
  }
  async function sendMessage(message) {
    if (!activeInstance) {
      throw new Error("pointerai-widget is not initialized.");
    }
    await activeInstance.sendMessage(message);
  }
  async function setEndUserToken(token) {
    if (!activeInstance) {
      throw new Error("pointerai-widget is not initialized.");
    }
    await activeInstance.setEndUserToken(token);
  }
  async function reconnect() {
    if (!activeInstance) {
      throw new Error("pointerai-widget is not initialized.");
    }
    await activeInstance.reconnect();
  }
  window.PointerAIWidget = { init, destroy, getInstance, open, close, sendMessage, setEndUserToken, reconnect };
  function tryAutoInit() {
    if (!window.pointeraiWidgetConfig) return;
    void init(window.pointeraiWidgetConfig).catch((error) => {
      console.error("pointerai-widget init failed", error);
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryAutoInit, { once: true });
  } else {
    tryAutoInit();
  }
})();
