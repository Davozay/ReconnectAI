/* ReConnect Shield API client.
   Talks to the live FastAPI Shield routes. When a Supabase session exists,
   every request carries its access token as a Bearer token (verified
   server-side via JWKS). Otherwise the server's explicit demo identity
   (X-Demo-User) is used — never a verified login. */

import { ApiError } from './api';
import { supabase } from './supabase';
import type { SessionUser } from '../context/auth-context';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export interface ShieldStatus {
  enabled: boolean;
  demo_mode: boolean;
  admin_configured: boolean;
  request_limit: number;
  message_limit: number;
}

export interface ShieldProfile {
  user_id: string;
  display_name: string;
  discoverable: boolean;
}

export interface ShieldRequest {
  id: string;
  from_id: string;
  to_id: string;
  message: string;
  status: string;
  created_at: number;
}

export interface ShieldRequestList {
  incoming: ShieldRequest[];
  outgoing: ShieldRequest[];
}

export interface ShieldWarning {
  code: string;
  title: string;
  detail: string;
}

export type ReportCategory =
  | 'impersonation'
  | 'scam'
  | 'harassment'
  | 'suspicious_message'
  | 'unauthorized_photo';

export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'suspicious_message', label: 'Suspicious message' },
  { value: 'unauthorized_photo', label: 'Unauthorized photo' },
];

/** Demo identity slug derived from the local session (server demo mode). */
export function shieldIdentity(user: SessionUser | null): string | null {
  if (!user) return null;
  const raw = user.email
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 32);
  if (raw.length >= 3) return raw;
  return `user-${raw || 'friend'}`;
}

export function shortId(userId: string): string {
  return userId.startsWith('demo:') ? userId.slice(5) : userId;
}

/** Auth headers: Supabase Bearer [REDACTED] when signed in, else demo identity. */
async function authHeaders(identity: string): Promise<Record<string, string>> {
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
    const token = data.session?.access_token;
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    /* fall through to demo identity */
  }
  return { 'X-Demo-User': identity };
}

async function shieldRequest<T>(
  path: string,
  identity: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...(await authHeaders(identity)), ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, 'Could not reach the ReConnect server.');
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let detail = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

function json(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  };
}

export async function getShieldStatus(): Promise<ShieldStatus | null> {
  try {
    const res = await fetch(`${API_BASE}/api/shield/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ShieldStatus;
  } catch {
    return null;
  }
}

export function updateShieldProfile(
  identity: string,
  displayName: string,
  discoverable: boolean,
) {
  return shieldRequest<ShieldProfile>('/api/shield/profile', identity, {
    ...json({ display_name: displayName, discoverable }),
    method: 'PATCH',
  });
}

export async function getMyShieldProfile(
  identity: string,
): Promise<ShieldProfile | null> {
  try {
    return await shieldRequest<ShieldProfile>('/api/shield/profile/me', identity, {
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export function getShieldRequests(identity: string) {
  return shieldRequest<ShieldRequestList>('/api/shield/requests', identity, {
    signal: AbortSignal.timeout(10000),
  });
}

export function acceptShieldRequest(identity: string, id: string) {
  return shieldRequest<ShieldRequest>(
    `/api/shield/requests/${id}/accept`,
    identity,
    json({}),
  );
}

export function declineShieldRequest(identity: string, id: string) {
  return shieldRequest<ShieldRequest>(
    `/api/shield/requests/${id}/decline`,
    identity,
    json({}),
  );
}

export function cancelShieldRequest(identity: string, id: string) {
  return shieldRequest<ShieldRequest>(
    `/api/shield/requests/${id}/cancel`,
    identity,
    json({}),
  );
}

export function blockShieldUser(identity: string, userId: string) {
  return shieldRequest<{ blocked: string[] }>('/api/shield/blocks', identity, json({
    user_id: userId,
  }));
}

export function unblockShieldUser(identity: string, userId: string) {
  return shieldRequest<{ blocked: string[] }>(
    `/api/shield/blocks/${encodeURIComponent(userId)}`,
    identity,
    { method: 'DELETE', signal: AbortSignal.timeout(10000) },
  );
}

export function getShieldBlocks(identity: string) {
  return shieldRequest<{ blocked: string[] }>('/api/shield/blocks', identity, {
    signal: AbortSignal.timeout(10000),
  });
}

export function createShieldReport(
  identity: string,
  report: {
    target_type: 'user' | 'message' | 'photo' | 'post';
    target_id: string;
    category: ReportCategory;
    details: string;
  },
) {
  return shieldRequest<{ id: string }>('/api/shield/reports', identity, json(report));
}

export function scamCheck(identity: string, text: string) {
  return shieldRequest<{ warnings: ShieldWarning[] }>(
    '/api/shield/scam-check',
    identity,
    json({ text }),
  );
}
