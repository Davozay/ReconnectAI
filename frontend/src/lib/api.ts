/* ReConnect AI API client.
   Live endpoints talk to FastAPI (which calls the Meta Model API
   server-side — keys never reach the browser). Every call below hits the
   real backend and throws ApiError on failure; there are no local
   fallbacks or invented responses. */

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8001';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(0, 'Could not reach the ReConnect server.');
  }
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

/* ---------- shared shapes ---------- */

export interface StatusResponse {
  configured: boolean;
  mode: 'live' | 'unconfigured';
  text_model: string;
  vision_model: string;
  max_photo_bytes: number;
  allowed_photo_types: string[];
}

export interface ExtractionItem {
  value: string;
  kind: 'school' | 'nickname' | 'location' | 'year' | 'name' | 'event' | 'clue';
  origin: 'stated' | 'inferred';
  confidence: 'high' | 'medium' | 'low';
}

export interface MemoryExtraction {
  schools: ExtractionItem[];
  nicknames: ExtractionItem[];
  locations: ExtractionItem[];
  years: ExtractionItem[];
  names_mentioned: ExtractionItem[];
  events: ExtractionItem[];
  summary: string;
}

export interface Clue {
  label: string;
  value: string;
  source: string;
}

export type AnalysisSource = 'vision_model' | 'ocr' | 'user_input';

export interface PhotoAnalysis {
  visible_description: string;
  extracted_text: string;
  possible_context: string | null;
  uncertain_observations: string[];
  user_confirmation_required: boolean;
  analysis_source: AnalysisSource;
}

export interface AnalyzeResponse {
  summary: string;
  clues: Clue[];
  extraction?: MemoryExtraction;
  analysis?: PhotoAnalysis;
}

export interface PhotoResponse extends AnalyzeResponse {
  visible_text: string;
  photo: {
    content_type: string;
    bytes: number;
    width: number | null;
    height: number | null;
  };
}

export interface AnalyzePayload {
  memory: string;
  nickname: string;
  school: string;
  location: string;
  hasPhoto: boolean;
}

export interface ConfirmedItem {
  kind: ExtractionItem['kind'];
  value: string;
  confirmed: boolean;
}

export interface ConfirmedProfile {
  schools: string[];
  nicknames: string[];
  locations: string[];
  years: string[];
  names_mentioned: string[];
  events: string[];
}

export interface MatchHighlights {
  schools: string[];
  places: string[];
  years: string[];
  nicknames: string[];
}

export interface ServerMatch {
  profile_id: string;
  display_name: string;
  detail: string;
  strength: 'Strong overlap' | 'Possible' | 'Worth a look';
  reasons: string[];
  highlights: MatchHighlights;
}

export interface DiscoverItem {
  id: string;
  title: string;
  author: string;
  school: string | null;
  place: string | null;
  year: string | null;
  seed: string;
  reasons: string[];
}

export interface DiscoverResponse {
  items: DiscoverItem[];
  note: string;
}

export interface MatchesResponse {
  matches: ServerMatch[];
  note: string;
}

/* ---------- live endpoints (throw ApiError on failure) ---------- */

export async function getStatus(): Promise<StatusResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/detective/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as StatusResponse;
  } catch {
    return null;
  }
}

export function analyzeMemoryLive(payload: AnalyzePayload) {
  return request<AnalyzeResponse>('/api/detective/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000),
  });
}

export function analyzePhotoLive(
  photo: File,
  notes: { memory: string; nickname: string },
) {
  const form = new FormData();
  form.append('photo', photo);
  form.append('memory', notes.memory);
  form.append('nickname', notes.nickname);
  return request<PhotoResponse>('/api/detective/analyze-photo', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(90000),
  });
}

export function confirmClues(items: ConfirmedItem[]) {
  return request<ConfirmedProfile>('/api/detective/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
    signal: AbortSignal.timeout(15000),
  });
}

export function getMatches(profile: ConfirmedProfile) {
  return request<MatchesResponse>('/api/detective/matches', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
    signal: AbortSignal.timeout(15000),
  });
}

export function getDiscover(profile: ConfirmedProfile) {
  return request<DiscoverResponse>('/api/detective/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
    signal: AbortSignal.timeout(15000),
  });
}

export type RescueTopic =
  | 'year'
  | 'place'
  | 'school'
  | 'names'
  | 'event'
  | 'scene'
  | 'details';

export interface RescueAnswerGiven {
  topic: RescueTopic;
  value: string;
  skipped: boolean;
  unknown: boolean;
}

export interface RescueQuestion {
  id: string;
  topic: RescueTopic;
  prompt: string;
  hint: string;
  placeholder: string;
}

export interface RescueQuestionsResponse {
  question: RescueQuestion | null;
  done: boolean;
  progress: { asked: number; remaining: number };
  message: string;
}

export interface RescueAnswerResponse {
  items: ExtractionItem[];
  source: 'ai' | 'direct' | 'none';
  note: string;
}

export interface RescueScene {
  objects: string[];
  setting: string;
}

export function getRescueQuestion(
  coveredKinds: string[],
  answers: RescueAnswerGiven[],
) {
  return request<RescueQuestionsResponse>('/api/detective/rescue/questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ covered_kinds: coveredKinds, answers }),
    signal: AbortSignal.timeout(15000),
  });
}

export function sendRescueAnswer(
  topic: RescueTopic,
  value: string,
  opts: { skipped?: boolean; unknown?: boolean } = {},
) {
  return request<RescueAnswerResponse>('/api/detective/rescue/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic,
      value,
      skipped: opts.skipped ?? false,
      unknown: opts.unknown ?? false,
    }),
    signal: AbortSignal.timeout(45000),
  });
}

export function getRescueDiscover(profile: ConfirmedProfile, scene: RescueScene) {
  return request<DiscoverResponse>('/api/detective/rescue/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile,
      scene_objects: scene.objects,
      scene_setting: scene.setting,
    }),
    signal: AbortSignal.timeout(15000),
  });
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}


