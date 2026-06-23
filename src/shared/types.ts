/** WebSocket & REST message types — shared with server contract (see docs/DESIGN.md) */

export type ClientMessageType = 'translate' | 'ping' | 'cancel' | 'auth';

export interface AuthPayload {
  accessToken: string;
}

export interface TranslatePayload {
  text: string;
  sourceLang?: string;
  targetLang: string;
  context?: string;
}

export interface ClientMessage {
  id: string;
  type: ClientMessageType;
  payload?: TranslatePayload | AuthPayload;
}

export type ServerMessageType =
  | 'connected'
  | 'translate_chunk'
  | 'translate_done'
  | 'translate_error'
  | 'pong'
  | 'auth_expired';

export interface TranslationExample {
  source: string;
  target: string;
}

export interface ServerMessagePayload {
  userId?: string;
  translation?: string;
  examples?: TranslationExample[];
  error?: string;
  code?: string;
}

export interface ServerMessage {
  id: string;
  type: ServerMessageType;
  payload?: ServerMessagePayload;
}

/** Extension runtime message protocol (content ↔ background) */

export type RuntimeMessage =
  | { type: 'TRANSLATE'; requestId: string; text: string; targetLang: string; tabId?: number }
  | { type: 'CANCEL'; requestId: string }
  | { type: 'GET_CONNECTION_STATUS' }
  | { type: 'LOGIN'; email: string; password: string }
  | { type: 'REGISTER'; email: string; password: string; referralCode?: string }
  | { type: 'RESEND_VERIFICATION'; email: string }
  | { type: 'LOGOUT' }
  | { type: 'GET_AUTH_STATUS' }
  | {
      type: 'TRANSLATION_UPDATE';
      requestId: string;
      status: TranslationStatus;
      translation?: string;
      examples?: TranslationExample[];
      error?: string;
    }
  | { type: 'CONNECTION_STATUS'; status: ConnectionStatus }
  | { type: 'AUTH_STATUS'; isAuthenticated: boolean; email?: string }
  | { type: 'LOGIN_RESULT'; success: boolean; error?: string; code?: string }
  | {
      type: 'REGISTER_RESULT';
      success: boolean;
      error?: string;
      code?: string;
      needsVerification?: boolean;
      email?: string;
    }
  | { type: 'RESEND_VERIFICATION_RESULT'; success: boolean; message?: string; error?: string };

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type TranslationStatus = 'loading' | 'streaming' | 'done' | 'error' | 'auth_required';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface UserSettings {
  targetLang: string;
  serverUrl: string;
  autoShowTrigger: boolean;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  email?: string;
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

export interface RestTranslateResponse {
  translation: string;
  examples?: TranslationExample[];
}

/** Reserved for v2 screenshot translation */
export type FutureClientMessage = {
  type: 'screenshot_translate';
  payload: { imageBase64: string; targetLang: string };
};
