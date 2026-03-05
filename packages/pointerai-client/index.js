/**
 * @typedef {'auto' | 'session' | 'end-user' | 'none'} AuthMode
 */

/**
 * @typedef {Object} PointerAIClientOptions
 * @property {string} baseUrl API base URL (for example https://api.example.com)
 * @property {string} projectId Agent/Project UUID
 * @property {string} publishableKey Agent publishable key (pk_...)
 * @property {string | null | undefined} [endUserToken] Optional JWT for login_required projects
 * @property {(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>} [fetch] Optional fetch implementation override
 */

/**
 * @typedef {Object} RequestOptions
 * @property {'GET' | 'POST'} [method]
 * @property {Record<string, unknown> | null} [body]
 * @property {string | null | undefined} [endUserToken]
 * @property {string | null | undefined} [sessionToken]
 * @property {AuthMode} [authMode]
 * @property {boolean} [allowEmpty]
 * @property {boolean} [retryOnAuthFailure]
 */

/**
 * Typed API error for non-2xx responses.
 */
export class PointerAIError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} data
   */
  constructor(message, status, data) {
    super(message);
    this.name = 'PointerAIError';
    /** @type {number} */
    this.status = status;
    /** @type {unknown} */
    this.data = data;
  }
}

/**
 * Create a random anon uid for anonymous chat sessions.
 * @param {string} [prefix]
 * @returns {string}
 */
export function createAnonUid(prefix = 'anon') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

/**
 * Lightweight PointerAI client for browser or Node.js.
 */
export class PointerAIClient {
  /**
   * @param {PointerAIClientOptions} options
   */
  constructor(options) {
    if (!options || typeof options !== 'object') {
      throw new Error('PointerAIClient options are required.');
    }
    if (!options.baseUrl || !String(options.baseUrl).trim()) {
      throw new Error('baseUrl is required.');
    }
    if (!options.projectId || !String(options.projectId).trim()) {
      throw new Error('projectId is required.');
    }
    if (!options.publishableKey || !String(options.publishableKey).trim()) {
      throw new Error('publishableKey is required.');
    }

    const providedFetch = options.fetch;
    const globalFetch = globalThis.fetch;
    if (typeof providedFetch !== 'function' && typeof globalFetch !== 'function') {
      throw new Error('No fetch implementation found. Pass options.fetch in Node environments.');
    }

    this.baseUrl = String(options.baseUrl).trim().replace(/\/+$/, '');
    this.projectId = String(options.projectId).trim();
    this.publishableKey = String(options.publishableKey).trim();
    this.endUserToken = options.endUserToken ? String(options.endUserToken).trim() : null;
    this.sessionToken = null;
    this.sessionExpiresAt = null;
    this.sessionRefreshAvailableAt = null;
    this.sessionId = null;
    if (typeof providedFetch === 'function') {
      this.fetchImpl = (input, init) => providedFetch(input, init);
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
      sessionId: this.sessionId,
    };
  }

  /**
   * Exchange end-user token for short-lived runtime session token.
   * @param {{ endUserToken?: string | null; sessionId?: string | null }} [options]
   * @returns {Promise<{token: string; expires_at: string; session_id: string | null; refresh_available_at: string}>}
   */
  async exchangeSessionToken(options = {}) {
    const tokenCandidate =
      typeof options.endUserToken === 'string' && options.endUserToken.trim()
        ? options.endUserToken.trim()
        : this.endUserToken;
    if (!tokenCandidate) {
      throw new Error('endUserToken is required to exchange a runtime session token.');
    }

    const body = {};
    if (options.sessionId) {
      body.session_id = String(options.sessionId).trim();
    }

    const response = await this.request('/api/runtime/sessions', {
      method: 'POST',
      body,
      endUserToken: tokenCandidate,
      authMode: 'end-user',
      retryOnAuthFailure: false,
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
    const tokenCandidate =
      typeof options.token === 'string' && options.token.trim()
        ? options.token.trim()
        : this.sessionToken;
    if (!tokenCandidate) {
      throw new Error('No session token available for refresh.');
    }

    const response = await this.request('/api/runtime/sessions/refresh', {
      method: 'POST',
      body: { token: tokenCandidate },
      authMode: 'none',
      retryOnAuthFailure: false,
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
    const tokenCandidate =
      typeof options.token === 'string' && options.token.trim()
        ? options.token.trim()
        : this.sessionToken;
    if (!tokenCandidate) {
      return;
    }

    await this.request('/api/runtime/sessions/revoke', {
      method: 'POST',
      body: { token: tokenCandidate },
      authMode: 'none',
      allowEmpty: true,
      retryOnAuthFailure: false,
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
          // Avoid retrying with a stale per-call sessionToken after successful refresh.
          if ('sessionToken' in retryOptions) {
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
      metadata: options.metadata || {},
    };
    if (options.anonUid) {
      body.anon_uid = options.anonUid;
    }
    return this.request('/api/chat/sessions', {
      method: 'POST',
      body,
      endUserToken: options.endUserToken,
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
      throw new Error('anonUid is required.');
    }
    const limit = Number.isFinite(options.limit) ? Number(options.limit) : 50;
    return this.request(
      `/api/chat/sessions/by-anon?anon_uid=${encodeURIComponent(String(anonUid).trim())}&limit=${encodeURIComponent(String(limit))}`,
      {
        method: 'GET',
        endUserToken: options.endUserToken,
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
      method: 'GET',
      endUserToken: options.endUserToken,
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
      throw new Error('sessionUid is required.');
    }
    const limit = Number.isFinite(options.limit) ? Number(options.limit) : 200;
    return this.request(
      `/api/chat/sessions/${encodeURIComponent(String(sessionUid).trim())}/messages?limit=${encodeURIComponent(String(limit))}`,
      {
        method: 'GET',
        endUserToken: options.endUserToken,
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
    if (!payload || typeof payload !== 'object') {
      throw new Error('chat payload is required.');
    }
    const message = payload.message ? String(payload.message).trim() : '';
    if (!message) {
      throw new Error('message is required.');
    }

    const body = {
      message,
      metadata: payload.metadata || {},
    };
    if (payload.sessionUid) {
      body.session_uid = String(payload.sessionUid).trim();
    }
    if (payload.anonUid) {
      body.anon_uid = String(payload.anonUid).trim();
    }

    return this.request('/api/chat', {
      method: 'POST',
      body,
      endUserToken: payload.endUserToken,
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
      sessionId: response.session_id || null,
    });
  }

  /**
   * @param {string} path
   * @param {RequestOptions} options
   * @returns {Promise<{response: Response, rawText: string, parsed: unknown, tokenSource: 'none' | 'session' | 'end-user'}>}
   */
  async _performRequest(path, options) {
    const method = options.method || 'GET';
    const { headers, tokenSource } = this._buildHeaders(method, options);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(options.body || {}),
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
      'X-Project-Id': this.projectId,
      'X-Project-Key': this.publishableKey,
    };

    const { token, source } = this._resolveAuthToken(options);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
    }
    return { headers, tokenSource: source };
  }

  /**
   * @param {RequestOptions} options
   * @returns {{token: string | null, source: 'none' | 'session' | 'end-user'}}
   */
  _resolveAuthToken(options) {
    const mode = options.authMode || 'auto';
    const sessionToken = 'sessionToken' in options ? this._trimOrNull(options.sessionToken) : this.sessionToken;
    const endUserToken = 'endUserToken' in options ? this._trimOrNull(options.endUserToken) : this.endUserToken;

    if (mode === 'none') {
      return { token: null, source: 'none' };
    }
    if (mode === 'session') {
      return sessionToken ? { token: sessionToken, source: 'session' } : { token: null, source: 'none' };
    }
    if (mode === 'end-user') {
      return endUserToken ? { token: endUserToken, source: 'end-user' } : { token: null, source: 'none' };
    }
    if (sessionToken) {
      return { token: sessionToken, source: 'session' };
    }
    if (endUserToken) {
      return { token: endUserToken, source: 'end-user' };
    }
    return { token: null, source: 'none' };
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
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        detail = parsed.detail;
      }
      throw new PointerAIError(
        this._formatErrorDetail(detail, rawText, response.status, response.statusText),
        response.status,
        parsed
      );
    }

    if (!rawText && allowEmpty) {
      return undefined;
    }
    if (!parsed) {
      throw new PointerAIError('Unexpected response format: expected JSON.', response.status, rawText);
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
    if (tokenSource !== 'session') {
      return false;
    }
    if (path === '/api/runtime/sessions/refresh' || path === '/api/runtime/sessions/revoke') {
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
    if (typeof detail === 'string' && detail.trim()) {
      return detail;
    }
    if (detail !== null && detail !== undefined) {
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
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed || null;
  }
}

/**
 * Convenience factory.
 * @param {PointerAIClientOptions} options
 * @returns {PointerAIClient}
 */
export function createPointerAIClient(options) {
  return new PointerAIClient(options);
}
