/* Mock data for UI development. Everything here is fictional and
   clearly labeled as simulated wherever it appears. */

export interface Story {
  id: string;
  user: string;
  color: string;
  seed: string;
  title: string;
  subtitle: string;
  viewed: boolean;
  mine?: boolean;
}

export const MOCK_STORIES: Story[] = [
  { id: 's0', user: 'You', color: '#6255e8', seed: 'you', title: 'Your story', subtitle: 'Tap to add', viewed: true, mine: true },
  { id: 's1', user: 'Maya R.', color: '#6255e8', seed: 'sports-day', title: 'Sports day ’98', subtitle: '2h ago', viewed: false },
  { id: 's2', user: 'Daniel O.', color: '#e85a4f', seed: 'story-hour', title: 'Story hour Fridays', subtitle: '4h ago', viewed: false },
  { id: 's3', user: 'Priya S.', color: '#16a34a', seed: 'picnic', title: 'Class picnic ’97', subtitle: '7h ago', viewed: false },
  { id: 's4', user: 'Jonah M.', color: '#0ea5e9', seed: 'trophy', title: 'The trophy mystery', subtitle: '12h ago', viewed: false },
  { id: 's5', user: 'Amara T.', color: '#d946ef', seed: 'lanterns', title: 'Paper lanterns', subtitle: '1d ago', viewed: true },
  { id: 's6', user: 'Leo K.', color: '#f59e0b', seed: 'walk-home', title: 'The walk home', subtitle: '1d ago', viewed: true },
];

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

export const MOCK_POSTS: FeedPost[] = [
  {
    id: 'p1',
    author: 'Maya R.',
    handle: '@maya-r',
    meta: 'Maplewood Elementary · Class of 2001',
    time: '2h',
    text: 'Found our 4th-grade sports day photo while cleaning the attic. Is that Jonah holding the trophy on the left? Someone please confirm my memory isn’t inventing this.',
    tags: ['Sports day 1998', 'Throwback'],
    schoolTag: 'Maplewood Elementary',
    likes: 24,
    color: '#6255e8',
    media: ['sports-day', 'trophy-close'],
    comments: [
      { id: 'c1', author: 'Jonah M.', color: '#0ea5e9', text: 'That IS me! I still have that trophy somewhere 😭', time: '1h' },
      { id: 'c2', author: 'Priya S.', color: '#16a34a', text: 'The banner! I helped paint that 🎨', time: '40m' },
    ],
  },
  {
    id: 'p2',
    author: 'Daniel O.',
    handle: '@dan-o',
    meta: 'St. Anne’s High · Class of 2005',
    time: '5h',
    text: 'Who else remembers Mrs. Whitfield’s legendary Friday storytelling hour? The one with the paper lanterns? Trying to piece together who sat in the back row with me.',
    tags: ['Mrs. Whitfield', 'Story hour'],
    schoolTag: 'St. Anne’s High',
    likes: 18,
    color: '#e85a4f',
    media: ['lanterns'],
    comments: [
      { id: 'c3', author: 'Amara T.', color: '#d946ef', text: 'Back row, every single Friday. I can still smell the paper glue.', time: '3h' },
    ],
  },
  {
    id: 'p3',
    author: 'Priya S.',
    handle: '@priya-s',
    meta: 'Riverside Primary · Class of 1999',
    time: '1d',
    text: 'POV: it’s 1997, the class picnic just started, and someone already dropped the cake. Sound on for maximum nostalgia.',
    tags: ['Class picnic', 'Memory reel'],
    schoolTag: 'Riverside Primary',
    likes: 47,
    color: '#16a34a',
    media: ['picnic'],
    reel: true,
    comments: [],
  },
  {
    id: 'p4',
    author: 'Jonah M.',
    handle: '@jo-jo',
    meta: 'Maplewood Elementary · Class of 2001',
    time: '2d',
    text: 'No photo for this one — just a question. Did our 3rd-grade classroom really have a reading corner shaped like a boat, or did I dream that??',
    tags: ['Help me remember'],
    likes: 12,
    color: '#0ea5e9',
    media: [],
    comments: [
      { id: 'c4', author: 'Maya R.', color: '#6255e8', text: 'THE BOAT. It was real and I can prove it — photo incoming.', time: '1d' },
    ],
  },
];

export interface PotentialMatch {
  id: string;
  name: string;
  handle: string;
  detail: string;
  school: string;
  place: string;
  category: 'classmate' | 'school' | 'neighborhood';
  confidence: 'Strong overlap' | 'Possible' | 'Worth a look';
  reasons: string[];
  color: string;
}

export const MOCK_MATCHES: PotentialMatch[] = [
  {
    id: 'm1',
    name: 'J. Mensah',
    handle: '@jo-jo',
    detail: 'Maplewood Elementary · 1996–2001 · Riverside',
    school: 'Maplewood Elementary',
    place: 'Riverside',
    category: 'classmate',
    confidence: 'Strong overlap',
    reasons: [
      'Same school and overlapping years (1996–2001)',
      'Listed “sports day” in a shared memory',
      'Nickname “Jo” resembles the “Jonah” in your note',
    ],
    color: '#6255e8',
  },
  {
    id: 'm2',
    name: 'A. Whitfield',
    handle: '@a-whit',
    detail: 'Maplewood Elementary · 1997–2002 · Riverside',
    school: 'Maplewood Elementary',
    place: 'Riverside',
    category: 'classmate',
    confidence: 'Possible',
    reasons: [
      'Same school, one year apart',
      'Same childhood neighborhood (Riverside)',
      'Opted into discovery for old friends',
    ],
    color: '#e85a4f',
  },
  {
    id: 'm3',
    name: 'S. Adeyemi',
    handle: '@s-ade',
    detail: 'Riverside Primary · 1995–2000 · Riverside',
    school: 'Riverside Primary',
    place: 'Riverside',
    category: 'neighborhood',
    confidence: 'Worth a look',
    reasons: [
      'Same hometown and era',
      'Memory mentions a “trophy” and “class banner”',
    ],
    color: '#16a34a',
  },
  {
    id: 'm4',
    name: 'T. Okafor',
    handle: '@t-oka',
    detail: 'St. Anne’s High · 2001–2005 · Riverside',
    school: 'St. Anne’s High',
    place: 'Riverside',
    category: 'school',
    confidence: 'Possible',
    reasons: [
      'Same high school era',
      'Follows the “Story hour Fridays” memory thread',
    ],
    color: '#0ea5e9',
  },
];

export interface Community {
  id: string;
  name: string;
  members: string;
  color: string;
  seed: string;
}

export const MOCK_COMMUNITIES: Community[] = [
  { id: 'g1', name: 'Maplewood Elementary Alumni', members: '2.1k members', color: '#6255e8', seed: 'maplewood' },
  { id: 'g2', name: 'Riverside ’90s Kids', members: '864 members', color: '#e85a4f', seed: 'riverside' },
  { id: 'g3', name: 'St. Anne’s Class of 2005', members: '312 members', color: '#0ea5e9', seed: 'stanne' },
];

export interface TrendingTag {
  id: string;
  tag: string;
  count: string;
}

export const MOCK_TRENDING: TrendingTag[] = [
  { id: 't1', tag: '#SportsDay98', count: '214 memories' },
  { id: 't2', tag: '#MrsWhitfield', count: '96 memories' },
  { id: 't3', tag: '#ClassPicnic97', count: '78 memories' },
];

export interface MemoryPrompt {
  id: string;
  prompt: string;
}

export const MEMORY_PROMPTS: MemoryPrompt[] = [
  { id: 'q1', prompt: 'What was your childhood nickname — and who gave it to you?' },
  { id: 'q2', prompt: 'Describe your walk to school. What did you pass every day?' },
  { id: 'q3', prompt: 'Who sat next to you in your favorite class?' },
];

export interface ConnectionRequest {
  id: string;
  name: string;
  handle: string;
  detail: string;
  reason: string;
  color: string;
  mutual: number;
}

export const MOCK_REQUESTS: ConnectionRequest[] = [
  { id: 'r1', name: 'Jonah M.', handle: '@jo-jo', detail: 'Maplewood Elementary · Class of 2001', reason: '“Maya! It’s Jo-Jo from 4B. Is that really you?”', color: '#0ea5e9', mutual: 6 },
  { id: 'r2', name: 'Amara T.', handle: '@amara-t', detail: 'Riverside · ’90s kid', reason: 'Shares 2 memories with you', color: '#d946ef', mutual: 3 },
  { id: 'r3', name: 'Leo K.', handle: '@leo-k', detail: 'St. Anne’s High · Class of 2005', reason: 'Same walk-home route', color: '#f59e0b', mutual: 1 },
];

export interface Connection {
  id: string;
  name: string;
  handle: string;
  detail: string;
  color: string;
}

export const MOCK_CONNECTIONS: Connection[] = [
  { id: 'k1', name: 'Maya R.', handle: '@maya-r', detail: 'Maplewood Elementary', color: '#6255e8' },
  { id: 'k2', name: 'Daniel O.', handle: '@dan-o', detail: 'St. Anne’s High', color: '#e85a4f' },
  { id: 'k3', name: 'Priya S.', handle: '@priya-s', detail: 'Riverside Primary', color: '#16a34a' },
  { id: 'k4', name: 'S. Adeyemi', handle: '@s-ade', detail: 'Riverside Primary', color: '#0ea5e9' },
];

export interface NotificationItem {
  id: string;
  text: string;
  time: string;
  unread: boolean;
  color: string;
  icon: 'heart' | 'message' | 'user' | 'sparkles';
}

export const MOCK_NOTIFICATIONS: NotificationItem[] = [
  { id: 'n1', text: 'Jonah M. liked your memory “Sports day trophy”', time: '10m', unread: true, color: '#0ea5e9', icon: 'heart' },
  { id: 'n2', text: 'New possible match: A. Whitfield (Maplewood ’97–’02)', time: '1h', unread: true, color: '#6255e8', icon: 'sparkles' },
  { id: 'n3', text: 'Amara T. sent you a reconnection request', time: '3h', unread: true, color: '#d946ef', icon: 'user' },
  { id: 'n4', text: 'Priya S. commented: “The banner! I helped paint that”', time: '1d', unread: false, color: '#16a34a', icon: 'message' },
  { id: 'n5', text: 'Daniel O. liked your comment', time: '2d', unread: false, color: '#e85a4f', icon: 'heart' },
];

export interface ProfileData {
  name: string;
  handle: string;
  bio: string;
  hometown: string;
  schools: { name: string; years: string }[];
  stats: { label: string; value: string }[];
  color: string;
  memories: string[];
}

export const MOCK_PROFILE: ProfileData = {
  name: 'Alex Rivers',
  handle: '@alex-r',
  bio: '’90s Riverside kid. Still looking for my 4B desk mate and the boat-shaped reading corner believers.',
  hometown: 'Riverside',
  schools: [
    { name: 'Maplewood Elementary', years: '1996 – 2001' },
    { name: 'St. Anne’s High', years: '2001 – 2005' },
  ],
  stats: [
    { label: 'Memories', value: '48' },
    { label: 'Connections', value: '132' },
    { label: 'Schools', value: '2' },
  ],
  color: '#6255e8',
  memories: ['sports-day', 'lanterns', 'picnic', 'trophy-close', 'boat-corner', 'walk-home'],
};

export function initials(name: string): string {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
