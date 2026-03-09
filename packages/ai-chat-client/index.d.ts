export interface PointerAIClientOptions {
  baseUrl: string;
  projectId: string;
  publishableKey: string;
  endUserToken?: string | null;
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export type AuthMode = 'auto' | 'session' | 'end-user' | 'none';

export interface Evidence {
  text: string;
  source_doc: string;
  score: number;
}

export interface ChatResponse {
  session_uid: string;
  message_uid: string | null;
  answer: string;
  source: string;
  confidence: number;
  evidence: Evidence[];
  created_at: string;
}

export interface ChatSessionResponse {
  uid: string;
  user_uid: string | null;
  anon_uid: string | null;
  device_uid: string | null;
  status: string;
  last_activity: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageResponse {
  uid: string;
  session_uid: string;
  speaker: string;
  content: string;
  metadata_json: Record<string, unknown> | null;
  created_at: string;
}

export interface SessionTokenResponse {
  token: string;
  expires_at: string;
  session_id: string | null;
  refresh_available_at: string;
}

export interface SessionTokenState {
  token: string | null;
  expiresAt: string | null;
  refreshAvailableAt: string | null;
  sessionId: string | null;
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown> | null;
  endUserToken?: string | null;
  sessionToken?: string | null;
  authMode?: AuthMode;
  allowEmpty?: boolean;
  retryOnAuthFailure?: boolean;
}

export class PointerAIError extends Error {
  status: number;
  data: unknown;
  constructor(message: string, status: number, data: unknown);
}

export function createAnonUid(prefix?: string): string;

export class PointerAIClient {
  baseUrl: string;
  projectId: string;
  publishableKey: string;
  endUserToken: string | null;
  sessionToken: string | null;
  sessionExpiresAt: string | null;
  sessionRefreshAvailableAt: string | null;
  sessionId: string | null;
  constructor(options: PointerAIClientOptions);
  setEndUserToken(token?: string | null): void;
  clearEndUserToken(): void;
  setSessionToken(
    token?: string | null,
    meta?: { expiresAt?: string | null; refreshAvailableAt?: string | null; sessionId?: string | null }
  ): void;
  clearSessionToken(): void;
  getSessionTokenState(): SessionTokenState;
  exchangeSessionToken(options?: { endUserToken?: string | null; sessionId?: string | null }): Promise<SessionTokenResponse>;
  refreshSessionToken(options?: { token?: string | null; persist?: boolean }): Promise<SessionTokenResponse>;
  revokeSessionToken(options?: { token?: string | null; clearSession?: boolean }): Promise<void>;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  createSession(options?: {
    anonUid?: string;
    metadata?: Record<string, unknown>;
    endUserToken?: string | null;
  }): Promise<ChatSessionResponse>;
  listSessionsByAnon(
    anonUid: string,
    options?: { limit?: number; endUserToken?: string | null }
  ): Promise<ChatSessionResponse[]>;
  listSessionsByUser(options?: { limit?: number; endUserToken?: string | null }): Promise<ChatSessionResponse[]>;
  listMessages(
    sessionUid: string,
    options?: { limit?: number; endUserToken?: string | null }
  ): Promise<ChatMessageResponse[]>;
  chat(payload: {
    message: string;
    sessionUid?: string;
    anonUid?: string;
    metadata?: Record<string, unknown>;
    endUserToken?: string | null;
  }): Promise<ChatResponse>;
}

export function createPointerAIClient(options: PointerAIClientOptions): PointerAIClient;
