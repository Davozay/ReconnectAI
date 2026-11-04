/* Shared feed types, memory prompts, and display helpers.
   All content shown in the app comes from Supabase or user input. */

export interface PostComment {
  id: string;
  author: string;
  color: string;
  text: string;
  time: string;
}

export interface FeedPost {
  id: string;
  author: string;
  handle: string;
  meta: string;
  time: string;
  text: string;
  tags: string[];
  schoolTag?: string;
  likes: number;
  comments: PostComment[];
  color: string;
  /** Memory-art seeds for the post gallery (empty = text-only post). */
  media: string[];
  reel?: boolean;
}

export interface MemoryPrompt {
  id: string;
  prompt: string;
}

export const MEMORY_PROMPTS: MemoryPrompt[] = [
  { id: 'q1', prompt: 'What was your childhood nickname — and who gave it to you?' },
  { id: 'q2', prompt: 'Describe your walk to school. What did you pass every day?' },
  { id: 'q3', prompt: 'Who sat next to you in your favorite class?' },
];

export function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
