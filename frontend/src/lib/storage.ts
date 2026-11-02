/* Private photo storage for ReConnect AI (Supabase Storage).
   Buckets are private; display uses short-lived signed URLs (default 60s).
   Object layout "<owner-uid>/<unique-name>" is enforced by storage policies
   so users can never write into another user's folder. */

import { requireSupabase } from './supabase';

export const PROFILE_BUCKET = 'profile-photos';
export const MEMORY_BUCKET = 'memory-photos';
export const CHAT_BUCKET = 'chat-attachments';
export const STORY_BUCKET = 'story-media';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const MAX_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 60;

export class StorageError extends Error {}

function checkFile(file: File): void {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new StorageError('Only JPEG, PNG, GIF, or WebP photos.');
  }
  if (file.size > MAX_BYTES) {
    throw new StorageError('Photo exceeds the 5 MB limit.');
  }
  if (file.size === 0) {
    throw new StorageError('Empty file.');
  }
}

async function currentUserId(): Promise<string> {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new StorageError('You must be signed in.');
  return data.user.id;
}

function objectName(file: File): string {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  return `${rand}.${ext || 'jpg'}`;
}

async function uploadTo(
  bucket: string,
  file: File,
): Promise<{ path: string; width: number | null; height: number | null }> {
  checkFile(file);
  const uid = await currentUserId();
  const path = `${uid}/${objectName(file)}`;
  const { error } = await requireSupabase().storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new StorageError(error.message || 'Upload failed.');
  const dims = await readDimensions(file).catch(() => null);
  return { path, width: dims?.width ?? null, height: dims?.height ?? null };
}

function readDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('unreadable image'));
    };
    img.src = url;
  });
}

async function signedUrl(
  bucket: string,
  path: string,
  expiresIn = SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  if (!path) throw new StorageError('No photo stored.');
  const { data, error } = await requireSupabase().storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    throw new StorageError(error?.message || 'Could not load that photo.');
  }
  return data.signedUrl;
}

async function removeFrom(bucket: string, path: string): Promise<void> {
  if (!path) return;
  const { error } = await requireSupabase().storage.from(bucket).remove([path]);
  if (error) throw new StorageError(error.message || 'Could not delete that photo.');
}

/* ---------- profile photos ---------- */

export function uploadProfilePhoto(file: File) {
  return uploadTo(PROFILE_BUCKET, file);
}

export function getProfilePhotoUrl(path: string, expiresIn = SIGNED_URL_TTL_SECONDS) {
  return signedUrl(PROFILE_BUCKET, path, expiresIn);
}

export function deleteProfilePhoto(path: string) {
  return removeFrom(PROFILE_BUCKET, path);
}

/* ---------- memory photos ---------- */

export function uploadMemoryPhoto(file: File) {
  return uploadTo(MEMORY_BUCKET, file);
}

export function getMemoryPhotoUrl(path: string, expiresIn = SIGNED_URL_TTL_SECONDS) {
  return signedUrl(MEMORY_BUCKET, path, expiresIn);
}

export function deleteMemoryPhotoObject(path: string) {
  return removeFrom(MEMORY_BUCKET, path);
}

/* ---------- chat attachments ---------- */

export function uploadChatAttachment(file: File) {
  return uploadTo(CHAT_BUCKET, file);
}

export function getChatAttachmentUrl(path: string, expiresIn = SIGNED_URL_TTL_SECONDS) {
  return signedUrl(CHAT_BUCKET, path, expiresIn);
}

/* ---------- story media ---------- */

export function uploadStoryMedia(file: File) {
  return uploadTo(STORY_BUCKET, file);
}

export function getStoryMediaUrl(path: string, expiresIn = SIGNED_URL_TTL_SECONDS) {
  return signedUrl(STORY_BUCKET, path, expiresIn);
}

export function deleteStoryMedia(path: string) {
  return removeFrom(STORY_BUCKET, path);
}
