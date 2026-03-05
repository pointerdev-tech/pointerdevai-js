import { PointerAIClient, PointerAIError, createAnonUid } from "@pointerdev/pointerai-client";

type Position = "left" | "right";
type WidgetRole = "user" | "assistant";
type StatusTone = "info" | "warn" | "error" | "success";

interface PointerAIWidgetConfig {
  apiBaseUrl: string;
  projectId: string;
  publishableKey: string;
  endUserToken?: string;
  getEndUserToken?: () => string | null | Promise<string | null>;
  anonUid?: string;
  metadata?: Record<string, unknown>;

  title?: string;
  subtitle?: string;
  launcherLabel?: string;
  launcherIcon?: string;
  launcherIconUrl?: string;
  logoUrl?: string;
  welcomeMessage?: string;
  placeholder?: string;
  sendLabel?: string;

  themeColor?: string;
  panelBackgroundColor?: string;
  messagesBackgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  panelBorderColor?: string;
  assistantBubbleColor?: string;
  assistantTextColor?: string;
  userBubbleColor?: string;
  userTextColor?: string;
  fontFamily?: string;
  borderRadius?: number;
  zIndex?: number;

  position?: Position;
  sideOffset?: number;
  bottomOffset?: number;
  width?: number;
  maxHeight?: number;
  openOnLoad?: boolean;
  historyFetchLimit?: number;
}

interface ResolvedWidgetConfig extends PointerAIWidgetConfig {
  title: string;
  subtitle: string;
  launcherLabel: string;
  launcherIcon: string;
  welcomeMessage: string;
  placeholder: string;
  sendLabel: string;

  themeColor: string;
  panelBackgroundColor: string;
  messagesBackgroundColor: string;
  textColor: string;
  mutedTextColor: string;
  panelBorderColor: string;
  assistantBubbleColor: string;
  assistantTextColor: string;
  userBubbleColor: string;
  userTextColor: string;
  fontFamily: string;
  borderRadius: number;
  zIndex: number;

  position: Position;
  sideOffset: number;
  bottomOffset: number;
  width: number;
  maxHeight: number;
  openOnLoad: boolean;
  historyFetchLimit: number;
}

interface WidgetMessage {
  role: WidgetRole;
  content: string;
  createdAt: string;
}

declare global {
  interface Window {
    pointeraiWidgetConfig?: PointerAIWidgetConfig;
    PointerAIWidget?: PointerAIWidgetGlobal;
  }
}

interface PointerAIWidgetGlobal {
  init: (config: PointerAIWidgetConfig) => Promise<PointerAIWidgetInstance>;
  destroy: () => void;
  getInstance: () => PointerAIWidgetInstance | null;
  open: () => void;
  close: () => void;
  sendMessage: (message: string) => Promise<void>;
  setEndUserToken: (token: string | null) => Promise<void>;
  reconnect: () => Promise<void>;
}

const DEFAULTS: Omit<
  ResolvedWidgetConfig,
  | "apiBaseUrl"
  | "projectId"
  | "publishableKey"
  | "endUserToken"
  | "anonUid"
  | "metadata"
  | "logoUrl"
  | "launcherIconUrl"
> = {
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
  zIndex: 2147483000,

  position: "right",
  sideOffset: 24,
  bottomOffset: 24,
  width: 360,
  maxHeight: 560,
  openOnLoad: false,
  historyFetchLimit: 100,
};

const REFRESH_POLL_MS = 15000;
const REFRESH_LEEWAY_MS = 3000;
const MAX_STORED_MESSAGES = 120;

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best-effort only.
  }
}

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Best-effort only.
  }
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function sanitizeConfig(config: PointerAIWidgetConfig): ResolvedWidgetConfig {
  if (!config.apiBaseUrl?.trim()) throw new Error("pointerai-widget: apiBaseUrl is required.");
  if (!config.projectId?.trim()) throw new Error("pointerai-widget: projectId is required.");
  if (!config.publishableKey?.trim()) throw new Error("pointerai-widget: publishableKey is required.");

  return {
    ...config,
    apiBaseUrl: config.apiBaseUrl.trim(),
    projectId: config.projectId.trim(),
    publishableKey: config.publishableKey.trim(),
    endUserToken: config.endUserToken?.trim(),
    anonUid: config.anonUid?.trim(),
    metadata: config.metadata ?? {},

    title: config.title ?? DEFAULTS.title,
    subtitle: config.subtitle ?? DEFAULTS.subtitle,
    launcherLabel: config.launcherLabel ?? DEFAULTS.launcherLabel,
    launcherIcon: config.launcherIcon ?? DEFAULTS.launcherIcon,
    welcomeMessage: config.welcomeMessage ?? DEFAULTS.welcomeMessage,
    placeholder: config.placeholder ?? DEFAULTS.placeholder,
    sendLabel: config.sendLabel ?? DEFAULTS.sendLabel,

    themeColor: config.themeColor ?? DEFAULTS.themeColor,
    panelBackgroundColor: config.panelBackgroundColor ?? DEFAULTS.panelBackgroundColor,
    messagesBackgroundColor: config.messagesBackgroundColor ?? DEFAULTS.messagesBackgroundColor,
    textColor: config.textColor ?? DEFAULTS.textColor,
    mutedTextColor: config.mutedTextColor ?? DEFAULTS.mutedTextColor,
    panelBorderColor: config.panelBorderColor ?? DEFAULTS.panelBorderColor,
    assistantBubbleColor: config.assistantBubbleColor ?? DEFAULTS.assistantBubbleColor,
    assistantTextColor: config.assistantTextColor ?? DEFAULTS.assistantTextColor,
    userBubbleColor: config.userBubbleColor ?? DEFAULTS.userBubbleColor,
    userTextColor: config.userTextColor ?? DEFAULTS.userTextColor,
    fontFamily: config.fontFamily ?? DEFAULTS.fontFamily,
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
    launcherIconUrl: config.launcherIconUrl,
  };
}

export class PointerAIWidgetInstance {
  private readonly config: ResolvedWidgetConfig;
  private readonly client: PointerAIClient;
  private readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly launcherEl: HTMLButtonElement;
  private readonly closeEl: HTMLButtonElement;
  private readonly panelEl: HTMLDivElement;
  private readonly messagesEl: HTMLDivElement;
  private readonly inputEl: HTMLTextAreaElement;
  private readonly sendEl: HTMLButtonElement;
  private readonly statusEl: HTMLDivElement;
  private readonly statusTextEl: HTMLSpanElement;
  private readonly statusRetryEl: HTMLButtonElement;

  private refreshTimer: number | null = null;
  private bootPromise: Promise<void> | null = null;
  private typingEl: HTMLDivElement | null = null;
  private lastFailedMessage: string | null = null;
  private isOpen = false;
  private isSending = false;
  private isBooting = false;
  private isOffline = false;

  private sessionUid: string | null = null;
  private anonUid: string | null = null;
  private messages: WidgetMessage[] = [];
  private storageScope = "guest";

  constructor(rawConfig: PointerAIWidgetConfig) {
    this.config = sanitizeConfig(rawConfig);
    this.client = new PointerAIClient({
      baseUrl: this.config.apiBaseUrl,
      projectId: this.config.projectId,
      publishableKey: this.config.publishableKey,
      endUserToken: this.config.endUserToken,
    });
    this.storageScope = this.deriveStorageScope(this.client.endUserToken ?? null, this.config.anonUid ?? null);

    this.host = document.createElement("div");
    this.host.setAttribute("data-pointerai-widget", "true");
    this.shadow = this.host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = this.buildMarkup();

    const launcherEl = this.shadow.querySelector<HTMLButtonElement>(".pa-launcher");
    const closeEl = this.shadow.querySelector<HTMLButtonElement>(".pa-close");
    const panelEl = this.shadow.querySelector<HTMLDivElement>(".pa-panel");
    const messagesEl = this.shadow.querySelector<HTMLDivElement>(".pa-messages");
    const inputEl = this.shadow.querySelector<HTMLTextAreaElement>(".pa-input");
    const sendEl = this.shadow.querySelector<HTMLButtonElement>(".pa-send");
    const statusEl = this.shadow.querySelector<HTMLDivElement>(".pa-status");
    const statusTextEl = this.shadow.querySelector<HTMLSpanElement>(".pa-status-text");
    const statusRetryEl = this.shadow.querySelector<HTMLButtonElement>(".pa-status-retry");

    if (
      !launcherEl ||
      !closeEl ||
      !panelEl ||
      !messagesEl ||
      !inputEl ||
      !sendEl ||
      !statusEl ||
      !statusTextEl ||
      !statusRetryEl
    ) {
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

  async mount(): Promise<void> {
    document.body.appendChild(this.host);
    this.bindEvents();
    this.loadState();
    this.renderHistory();
    if (this.config.openOnLoad) this.setOpen(true);
    this.bootPromise = this.bootstrap();
    await this.bootPromise;
  }

  destroy(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("offline", this.onOffline);
    this.host.remove();
  }

  async logout(): Promise<void> {
    await this.client.revokeSessionToken({ clearSession: true });
    this.client.clearSessionToken();
    this.sessionUid = null;
    this.persistSessionUid(null);
  }

  open(): void {
    this.setOpen(true);
  }

  close(): void {
    this.setOpen(false);
  }

  async sendMessage(message: string): Promise<void> {
    await this.handleSend(message);
  }

  async setEndUserToken(token: string | null): Promise<void> {
    const nextToken = token?.trim() || null;
    this.client.setEndUserToken(nextToken);
    this.rebindStorageScope(nextToken, this.anonUid);
    await this.recoverConnection();
  }

  async reconnect(): Promise<void> {
    await this.recoverConnection();
  }

  private bindEvents(): void {
    this.launcherEl.addEventListener("click", () => this.setOpen(!this.isOpen));
    this.closeEl.addEventListener("click", () => this.setOpen(false));
    this.sendEl.addEventListener("click", () => {
      void this.handleSend();
    });
    this.statusRetryEl.addEventListener("click", () => {
      void this.retryLastFailedMessage();
    });
    this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
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

  private readonly onOnline = (): void => {
    this.isOffline = false;
    this.setStatus("Back online. Reconnecting...", "info", false);
    void this.recoverConnection();
  };

  private readonly onOffline = (): void => {
    this.isOffline = true;
    this.updateComposerState();
    this.setStatus("Offline. Waiting for connection...", "warn", false);
  };

  private async resolveEndUserToken(): Promise<string | null> {
    const current = this.client.endUserToken?.trim() || null;
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

  private async recoverConnection(): Promise<void> {
    try {
      const endUserToken = await this.resolveEndUserToken();
      if (endUserToken) {
        await this.client.exchangeSessionToken({ sessionId: this.sessionUid ?? undefined });
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

  private async bootstrap(): Promise<void> {
    this.isBooting = true;
    this.updateComposerState();
    this.setStatus("Connecting...", "info", false);
    try {
      const endUserToken = await this.resolveEndUserToken();
      if (endUserToken) {
        await this.client.exchangeSessionToken({ sessionId: this.sessionUid ?? undefined });
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

  private async syncHistoryFromServer(): Promise<void> {
    if (!this.sessionUid) return;
    try {
      const messages = await this.client.listMessages(this.sessionUid, {
        limit: this.config.historyFetchLimit,
      });
      const mapped = messages
        .filter((item) => typeof item.content === "string" && item.content.trim() !== "")
        .map((item) => ({
          role: item.speaker === "user" ? "user" : "assistant",
          content: item.content,
          createdAt: item.created_at,
        } satisfies WidgetMessage))
        .sort((a, b) => {
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
      // Keep local cache when backend history fetch fails.
    }
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionUid) return;

    const payload: { anonUid?: string; metadata?: Record<string, unknown> } = {
      metadata: this.buildMetadata(),
    };
    if (this.anonUid) payload.anonUid = this.anonUid;

    const session = await this.client.createSession(payload);
    this.sessionUid = session.uid;
    this.persistSessionUid(this.sessionUid);
  }

  private async handleSend(retryMessage?: string): Promise<void> {
    const text = (retryMessage ?? this.inputEl.value).trim();
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
        sessionUid: this.sessionUid ?? undefined,
        anonUid: this.anonUid ?? undefined,
        metadata: this.buildMetadata(),
      });
      this.sessionUid = response.session_uid ?? this.sessionUid;
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

  private async retryLastFailedMessage(): Promise<void> {
    if (!this.lastFailedMessage || this.isSending || this.isBooting) return;
    const retryText = this.lastFailedMessage;
    this.setStatus("Retrying...", "info", false);
    await this.handleSend(retryText);
  }

  private startRefreshTimer(): void {
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
    }
    this.refreshTimer = window.setInterval(() => {
      void this.tryRefreshSessionToken();
    }, REFRESH_POLL_MS);
  }

  private async tryRefreshSessionToken(): Promise<void> {
    if (this.isOffline || this.isBooting) return;

    const state = this.client.getSessionTokenState();
    if (!state.token || !state.refreshAvailableAt) return;

    const refreshAt = Date.parse(state.refreshAvailableAt);
    if (Number.isNaN(refreshAt)) return;
    if (Date.now() < refreshAt - REFRESH_LEEWAY_MS) return;

    try {
      await this.client.refreshSessionToken({ persist: true });
    } catch {
      // Request-level auto-refresh/retry still handles auth failures.
    }
  }

  private showTyping(): void {
    if (this.typingEl) return;
    const row = document.createElement("div");
    row.className = "pa-message pa-assistant pa-typing";
    row.innerHTML = '<span class="pa-dot"></span><span class="pa-dot"></span><span class="pa-dot"></span>';
    this.typingEl = row;
    this.messagesEl.appendChild(row);
    this.scrollToBottom();
  }

  private hideTyping(): void {
    if (!this.typingEl) return;
    this.typingEl.remove();
    this.typingEl = null;
  }

  private updateComposerState(): void {
    const disabled = this.isSending || this.isBooting || this.isOffline;
    this.sendEl.disabled = disabled;
    this.inputEl.disabled = disabled;
  }

  private addMessage(role: WidgetRole, content: string, persist: boolean): void {
    const message: WidgetMessage = {
      role,
      content,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(message);
    if (this.messages.length > MAX_STORED_MESSAGES) {
      this.messages = this.messages.slice(-MAX_STORED_MESSAGES);
    }
    this.renderMessage(message);
    if (persist) this.persistMessages();
  }

  private renderHistory(): void {
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

  private renderMessage(message: WidgetMessage): void {
    const row = document.createElement("div");
    row.className = `pa-message pa-${message.role}`;
    row.textContent = message.content;
    this.messagesEl.appendChild(row);
    this.scrollToBottom();
  }

  private setOpen(value: boolean): void {
    this.isOpen = value;
    this.panelEl.classList.toggle("open", value);
    if (value) this.inputEl.focus();
  }

  private setStatus(message: string, tone: StatusTone, showRetry: boolean): void {
    this.statusEl.dataset.tone = tone;
    this.statusTextEl.textContent = message;
    this.statusRetryEl.style.display = showRetry ? "inline-flex" : "none";
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private loadState(): void {
    if (!this.isStorageEnabled()) {
      this.sessionUid = null;
      this.anonUid = this.config.anonUid ?? null;
      this.messages = [];
      return;
    }

    this.sessionUid = readJson<string>(this.storageKey("session_uid"));
    this.anonUid = this.config.anonUid ?? readJson<string>(this.storageKey("anon_uid"));
    this.messages = readJson<WidgetMessage[]>(this.storageKey("messages")) ?? [];
  }

  private persistAnonUid(value: string | null): void {
    if (!this.isStorageEnabled()) return;
    if (value) writeJson(this.storageKey("anon_uid"), value);
    else removeKey(this.storageKey("anon_uid"));
  }

  private persistSessionUid(value: string | null): void {
    if (!this.isStorageEnabled()) return;
    if (value) writeJson(this.storageKey("session_uid"), value);
    else removeKey(this.storageKey("session_uid"));
  }

  private persistMessages(): void {
    if (!this.isStorageEnabled()) return;
    writeJson(this.storageKey("messages"), this.messages);
  }

  private storageKey(name: string): string {
    return `pointerai_widget:${this.config.projectId}:${this.storageScope}:${name}`;
  }

  private isStorageEnabled(): boolean {
    return this.storageScope !== "pending-auth";
  }

  private rebindStorageScope(endUserToken: string | null, anonUid: string | null): void {
    const nextScope = this.deriveStorageScope(endUserToken, anonUid);
    if (nextScope === this.storageScope) {
      return;
    }
    this.storageScope = nextScope;
    this.loadState();
    this.renderHistory();
  }

  private deriveStorageScope(endUserToken: string | null, anonUid: string | null): string {
    const token = endUserToken?.trim() || null;
    if (token) {
      const subject = this.extractJwtSubject(token);
      if (subject) {
        return `user:${this.normalizeStorageScopePart(subject)}`;
      }
      return `token:${this.hashString(token)}`;
    }
    if (typeof this.config.getEndUserToken === "function") {
      // Avoid showing stale cache before identity is resolved in login-required mode.
      return "pending-auth";
    }
    const anon = anonUid?.trim() || null;
    if (anon) {
      return `anon:${this.normalizeStorageScopePart(anon)}`;
    }
    return "guest";
  }

  private extractJwtSubject(token: string): string | null {
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
      const parsed = JSON.parse(decoded) as { sub?: unknown };
      if (typeof parsed.sub === "string" && parsed.sub.trim() !== "") {
        return parsed.sub.trim();
      }
    } catch {
      return null;
    }
    return null;
  }

  private normalizeStorageScopePart(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9:_-]/g, "_").slice(0, 120);
  }

  private hashString(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  private buildMetadata(): Record<string, unknown> {
    return {
      source: "pointerai-widget",
      ...this.config.metadata,
    };
  }

  private renderError(error: unknown): string {
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
      const detail = (error.data as { detail?: unknown } | null)?.detail;
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

  private escapeHtml(input: string): string {
    return input
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private buildMarkup(): string {
    const side = this.config.position === "left" ? "left" : "right";
    const logoHtml = this.config.logoUrl
      ? `<img class="pa-logo" src="${this.escapeHtml(this.config.logoUrl)}" alt="logo" />`
      : "";
    const launcherIconHtml = this.config.launcherIconUrl
      ? `<img class="pa-launcher-icon-img" src="${this.escapeHtml(this.config.launcherIconUrl)}" alt="chat" />`
      : `<span class="pa-launcher-icon">${this.escapeHtml(this.config.launcherIcon)}</span>`;

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
      <button class="pa-close" type="button" aria-label="Close chat">×</button>
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
}

let activeInstance: PointerAIWidgetInstance | null = null;

async function init(config: PointerAIWidgetConfig): Promise<PointerAIWidgetInstance> {
  if (activeInstance) {
    activeInstance.destroy();
    activeInstance = null;
  }
  const instance = new PointerAIWidgetInstance(config);
  activeInstance = instance;
  await instance.mount();
  return instance;
}

function destroy(): void {
  if (!activeInstance) return;
  activeInstance.destroy();
  activeInstance = null;
}

function getInstance(): PointerAIWidgetInstance | null {
  return activeInstance;
}

function open(): void {
  activeInstance?.open();
}

function close(): void {
  activeInstance?.close();
}

async function sendMessage(message: string): Promise<void> {
  if (!activeInstance) {
    throw new Error("pointerai-widget is not initialized.");
  }
  await activeInstance.sendMessage(message);
}

async function setEndUserToken(token: string | null): Promise<void> {
  if (!activeInstance) {
    throw new Error("pointerai-widget is not initialized.");
  }
  await activeInstance.setEndUserToken(token);
}

async function reconnect(): Promise<void> {
  if (!activeInstance) {
    throw new Error("pointerai-widget is not initialized.");
  }
  await activeInstance.reconnect();
}

window.PointerAIWidget = { init, destroy, getInstance, open, close, sendMessage, setEndUserToken, reconnect };

function tryAutoInit(): void {
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
