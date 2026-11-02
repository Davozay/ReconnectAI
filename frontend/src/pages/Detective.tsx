import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BookmarkPlus,
  CalendarDays,
  Check,
  GraduationCap,
  ImagePlus,
  Images,
  LifeBuoy,
  LoaderCircle,
  Lock,
  MapPin,
  Quote,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Smile,
  Sparkles,
  ScrollText,
  Trash2,
  Users,
  ZoomIn,
} from 'lucide-react';
import ConnectionCard from '../components/ConnectionCard';
import type { CardMatch } from '../components/ConnectionCard';
import MediaLightbox from '../components/MediaLightbox';
import MemoryArt from '../components/MemoryArt';
import MemoryRescue from '../components/MemoryRescue';
import SimBadge from '../components/SimBadge';
import { MOCK_MATCHES } from '../data/mock';
import {
  analyzeMemory,
  analyzeMemoryLive,
  analyzePhotoLive,
  confirmClues,
  getDiscover,
  getMatches,
  getRescueDiscover,
  getStatus,
  ApiError,
} from '../lib/api';
import type {
  AnalyzeResponse,
  ConfirmedItem,
  DiscoverItem,
  MemoryExtraction,
  RescueScene,
  ServerMatch,
} from '../lib/api';
import { useAuth } from '../context/useAuth';
import { useToast } from '../context/useToast';
import { DbError, addMemoryPhoto, createMemory } from '../lib/db';
import { StorageError, uploadMemoryPhoto } from '../lib/storage';
import './Detective.css';

const STAGES = [
  'Reading your photo',
  'Extracting text & scene details',
  'Understanding your memory',
  'Searching people who opted in',
];

type Phase = 'idle' | 'analyzing' | 'done' | 'error';
type Mode = 'checking' | 'live' | 'demo';

interface EditItem extends ConfirmedItem {
  origin?: 'stated' | 'inferred';
  confidence?: 'high' | 'medium' | 'low';
}

const MATCH_COLORS = ['#6255e8', '#e85a4f', '#16a34a', '#0ea5e9', '#d946ef'];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return MATCH_COLORS[hash % MATCH_COLORS.length];
}

function flatten(extraction: MemoryExtraction): EditItem[] {
  const groups: [EditItem['kind'], MemoryExtraction[keyof MemoryExtraction]][] = [
    ['school', extraction.schools],
    ['nickname', extraction.nicknames],
    ['location', extraction.locations],
    ['year', extraction.years],
    ['name', extraction.names_mentioned],
    ['event', extraction.events],
  ];
  return groups.flatMap(([kind, items]) =>
    (Array.isArray(items) ? items : []).map((item) => ({
      kind,
      value: item.value,
      confirmed: true,
      origin: item.origin,
      confidence: item.confidence,
    })),
  );
}

function toCardMatch(m: ServerMatch): CardMatch {
  return {
    id: m.profile_id,
    name: m.display_name,
    detail: m.detail,
    strength: m.strength,
    reasons: m.reasons,
    color: colorFor(m.profile_id),
    highlights: m.highlights,
  };
}

const GROUPS = [
  { kinds: ['school'], title: 'Schools', icon: GraduationCap },
  { kinds: ['year'], title: 'Dates', icon: CalendarDays },
  { kinds: ['location'], title: 'Locations', icon: MapPin },
  { kinds: ['nickname', 'name'], title: 'Names', icon: Smile },
  { kinds: ['event', 'clue'], title: 'Moments', icon: Sparkles },
] as const;

export default function Detective() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [memory, setMemory] = useState('');
  const [nickname, setNickname] = useState('');
  const [school, setSchool] = useState('');
  const [location, setLocation] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [mode, setMode] = useState<Mode>('checking');
  const [demoOptIn, setDemoOptIn] = useState(false);
  const [backendUp, setBackendUp] = useState(false);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<EditItem[]>([]);
  const [matches, setMatches] = useState<ServerMatch[] | null>(null);
  const [matchNote, setMatchNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [discover, setDiscover] = useState<DiscoverItem[] | null>(null);
  const [discNote, setDiscNote] = useState('');
  const [zoom, setZoom] = useState(-1);
  const [discZoom, setDiscZoom] = useState(-1);
  const [rescueOpen, setRescueOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    getStatus().then((status) => {
      if (!active) return;
      setBackendUp(status !== null);
      setMode(status?.configured ? 'live' : 'demo');
    });
    return () => {
      active = false;
    };
  }, []);

  const canAnalyze =
    (photoUrl !== null || memory.trim() !== '') &&
    phase !== 'analyzing' &&
    mode !== 'checking';

  const setFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(file);
    setPhotoUrl(URL.createObjectURL(file));
  };

  const removePhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoFile(null);
    setPhotoUrl(null);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setFile(e.dataTransfer.files[0]);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0]);
    e.target.value = '';
  };

  const runMatches = async (items: ConfirmedItem[], scene?: RescueScene) => {
    setConfirming(true);
    try {
      const profile = await confirmClues(items);
      const response = await getMatches(profile);
      setMatches(response.matches);
      setMatchNote(response.note);
      try {
        const hasScene =
          scene && (scene.objects.length > 0 || scene.setting.trim() !== '');
        const disc = hasScene
          ? await getRescueDiscover(profile, scene as RescueScene)
          : await getDiscover(profile);
        setDiscover(disc.items);
        setDiscNote(disc.note);
      } catch {
        setDiscover(null);
        setDiscNote('');
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Matching failed. Retry shortly.',
      );
      setPhase('error');
    } finally {
      setConfirming(false);
    }
  };

  const runAnalysis = async () => {
    if (!canAnalyze) return;
    setPhase('analyzing');
    setResult(null);
    setMatches(null);
    setMatchNote('');
    setDiscover(null);
    setDiscNote('');
    setRescueOpen(false);
    setSavedId(null);
    setError('');
    setStage(0);
    const ticker = window.setInterval(
      () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
      1100,
    );
    try {
      // Re-check the backend on every run: it may have started (or gained
      // its API key) after this page loaded.
      const status = await getStatus();
      const liveNow = status?.configured === true;
      setBackendUp(status !== null);
      setMode(liveNow ? 'live' : 'demo');
      if (!liveNow && !demoOptIn) {
        // Honest failure, never a silent simulated substitute.
        setError(
          status === null
            ? 'Could not reach the ReConnect server. Start the backend, then retry.'
            : 'The AI service is not configured on the server. Set META_MODEL_API_KEY there, restart it, then retry.',
        );
        setPhase('error');
        return;
      }
      if (!liveNow) {
        const res = await analyzeMemory();
        setResult(res);
        setPhase('done');
        return;
      }
      setDemoOptIn(false);
      const res =
        photoFile !== null
          ? await analyzePhotoLive(photoFile, { memory, nickname })
          : await analyzeMemoryLive({
              memory,
              nickname,
              school,
              location,
              hasPhoto: false,
            });
      setResult(res);
      const items = res.extraction ? flatten(res.extraction) : [];
      setEdits(items);
      setPhase('done');
      if (items.length > 0) void runMatches(items);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Analysis failed. Retry shortly.',
      );
      setPhase('error');
    } finally {
      window.clearInterval(ticker);
      setStage(STAGES.length - 1);
    }
  };

  const saveAsMemory = async () => {
    if (!result || saving) return;
    setSaving(true);
    try {
      const confirmed = edits.filter((e) => e.confirmed && e.value.trim());
      const parts: string[] = [];
      if (memory.trim()) parts.push(memory.trim());
      parts.push(result.summary);
      if (confirmed.length > 0) {
        parts.push(
          '',
          'Confirmed clues:',
          ...confirmed.map((e) => `• ${e.kind}: ${e.value.trim()}`),
        );
      }
      if (result.analysis?.extracted_text?.trim()) {
        parts.push('', `Text in the photo: “${result.analysis.extracted_text.trim()}”`);
      }
      const saved = await createMemory({
        title: saveTitle.trim(),
        body: parts.join('\n'),
        shared: false,
        analysis: {
          summary: result.summary,
          clues: result.clues,
          confirmed: confirmed.map((e) => ({ kind: e.kind, value: e.value.trim() })),
          visible_text: result.analysis?.extracted_text ?? '',
          analysis_source: result.analysis?.analysis_source ?? 'vision_model',
          saved_from: 'detective',
        },
      });
      if (photoFile) {
        const up = await uploadMemoryPhoto(photoFile);
        await addMemoryPhoto({
          memory_id: saved.id,
          storage_path: up.path,
          content_type: photoFile.type,
          bytes: photoFile.size,
          width: up.width,
          height: up.height,
        });
      }
      setSavedId(saved.id);
      toast('Saved as a private memory — nothing was published');
    } catch (err) {
      toast(
        err instanceof DbError || err instanceof StorageError || err instanceof Error
          ? err.message
          : 'Could not save that memory.',
      );
    } finally {
      setSaving(false);
    }
  };

  const updateEdit = (index: number, value: string) => {
    setEdits((prev) =>
      prev.map((item, i) => (i === index ? { ...item, value } : item)),
    );
  };

  const toggleEdit = (index: number) => {
    setEdits((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, confirmed: !item.confirmed } : item,
      ),
    );
  };

  const useDemoInstead = () => {
    setMode('demo');
    setDemoOptIn(true);
    setPhase('idle');
    setError('');
  };

  const isLive = mode === 'live' && !!result && !result.simulated;
  const userInputs = [
    memory.trim() && { label: 'Memory', value: memory.trim() },
    nickname.trim() && { label: 'Nickname', value: nickname.trim() },
    school.trim() && { label: 'School', value: school.trim() },
    location.trim() && { label: 'Place', value: location.trim() },
  ].filter((x): x is { label: string; value: string } => !!x);

  const demoCards: CardMatch[] = MOCK_MATCHES.map((m) => ({
    id: m.id,
    name: m.name,
    detail: m.detail,
    strength: m.confidence,
    reasons: m.reasons,
    color: m.color,
    highlights: {
      schools: m.school ? [m.school] : [],
      places: m.place ? [m.place] : [],
      years: [],
      nicknames: [],
    },
  }));
  const liveCards: CardMatch[] = (matches ?? []).map(toCardMatch);

  const extractionCount = result?.extraction
    ? result.extraction.schools.length +
      result.extraction.nicknames.length +
      result.extraction.locations.length +
      result.extraction.years.length +
      result.extraction.names_mentioned.length +
      result.extraction.events.length
    : 0;
  const hasPhotoText = !!result?.analysis?.extracted_text?.trim();
  const rescueNeeded =
    isLive && photoFile !== null && extractionCount === 0 && !hasPhotoText;
  const coveredKinds = result?.extraction
    ? [
        result.extraction.schools.length > 0 && 'school',
        result.extraction.nicknames.length > 0 && 'nickname',
        result.extraction.locations.length > 0 && 'location',
        result.extraction.years.length > 0 && 'year',
        result.extraction.names_mentioned.length > 0 && 'name',
        result.extraction.events.length > 0 && 'event',
      ].filter((k): k is string => !!k)
    : [];

  const handleRescued = (items: ConfirmedItem[], scene: RescueScene) => {
    const seen = new Set(
      edits.map((e) => `${e.kind}:${e.value.toLowerCase()}`),
    );
    const merged = [
      ...edits,
      ...items.filter(
        (item) => !seen.has(`${item.kind}:${item.value.toLowerCase()}`),
      ),
    ];
    setEdits(merged);
    void runMatches(merged, scene);
  };

  return (
    <div className="detective">
      <header className="detective-head">
        <div>
          <p className="kicker">AI Memory Detective</p>
          <h1 className="detective-title">What do you remember?</h1>
          <p className="detective-sub">
            Upload an old photo, add a memory or nickname — the Detective
            extracts clues and suggests people who share them.
          </p>
        </div>
        {mode === 'live' && <span className="pill pill-green">Live AI</span>}
        {mode === 'demo' && <SimBadge label="Simulated analysis" />}
        {mode === 'checking' && (
          <span className="pill pill-neutral">Checking…</span>
        )}
      </header>

      <div className="notice notice-indigo detective-privacy">
        <ShieldCheck size={18} aria-hidden="true" />
        {mode === 'live' ? (
          <p>
            <strong>Live analysis:</strong> your photo is sent securely to the
            Meta Model API for text and scene reading only — never for face
            identification. Matches are <em>possibilities with explanations</em>,
            not verified identities.
          </p>
        ) : (
          <p>
            <strong>Private by default:</strong> your photo preview never leaves
            this browser in the demo, and ReConnect AI never identifies people by
            face. Matches are <em>possibilities with explanations</em>, not
            verified identities.
          </p>
        )}
      </div>

      <div className="detective-grid">
        {/* INPUT PANEL */}
        <section className="card card-pad detective-input" aria-label="Your clues">
          {photoUrl ? (
            <div className="preview-wrap">
              <button
                type="button"
                className="preview-frame"
                onClick={() => setZoom(0)}
                aria-label="Zoom uploaded photo"
              >
                <img
                  src={photoUrl}
                  alt="Your uploaded childhood photo"
                  className="preview-img"
                />
                <span className="preview-zoom-hint">
                  <ZoomIn size={15} aria-hidden="true" />
                  Zoom
                </span>
                {phase === 'analyzing' && (
                  <span className="preview-progress">
                    <LoaderCircle size={22} className="spin" aria-hidden="true" />
                    {STAGES[stage]}…
                  </span>
                )}
              </button>
              <div className="preview-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  Replace
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={removePhoto}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Remove
                </button>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPick}
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload a childhood photo"
              className={`dropzone${dragOver ? ' is-drag' : ''}`}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <ImagePlus size={30} strokeWidth={1.5} aria-hidden="true" />
              <p>
                <strong>Drop a childhood photo here</strong>
                <span>or click to browse — JPG, PNG, WebP, or GIF</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onPick}
                aria-hidden="true"
                tabIndex={-1}
              />
            </div>
          )}
          <p className="dropzone-lock">
            <Lock size={13} aria-hidden="true" />
            {mode === 'live'
              ? 'Sent securely for AI analysis · never public'
              : 'Only you can see this upload'}
          </p>

          <label className="field">
            <span className="field-label">
              <ScrollText size={15} aria-hidden="true" />
              The memory, in your words
            </span>
            <textarea
              className="textarea"
              placeholder="Sports day, 4th grade. I think Jonah won the race and we all signed the class banner…"
              value={memory}
              onChange={(e) => setMemory(e.target.value)}
              rows={4}
            />
          </label>

          <div className="detective-row">
            <label className="field">
              <span className="field-label">
                <Smile size={15} aria-hidden="true" />
                Nickname
              </span>
              <input
                className="input"
                placeholder="e.g. Jo-Jo"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">
                <MapPin size={15} aria-hidden="true" />
                Place
              </span>
              <input
                className="input"
                placeholder="e.g. Riverside"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">
              <GraduationCap size={15} aria-hidden="true" />
              School (optional)
            </span>
            <input
              className="input"
              placeholder="e.g. Maplewood Elementary"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
            />
          </label>

          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            disabled={!canAnalyze}
            onClick={() => runAnalysis()}
          >
            {phase === 'analyzing' ? (
              <>
                <LoaderCircle size={18} className="spin" aria-hidden="true" />
                Investigating…
              </>
            ) : (
              <>
                <ScanSearch size={18} aria-hidden="true" />
                Analyze my clues
              </>
            )}
          </button>
        </section>

        {/* RESULTS PANEL */}
        <section className="detective-results" aria-label="Analysis results" aria-live="polite">
          {phase === 'idle' && (
            <div className="card card-pad results-empty">
              <Sparkles size={28} strokeWidth={1.5} aria-hidden="true" />
              <h2>Your clues will appear here</h2>
              <p>
                Add a photo, a memory, or both — then run the analysis to see
                extracted details and people you may know.
              </p>
            </div>
          )}

          {phase === 'analyzing' && (
            <div className="card card-pad">
              <h2 className="results-title">Following the trail…</h2>
              <ol className="stages">
                {STAGES.map((label, i) => (
                  <li
                    key={label}
                    className={`stage${i < stage ? ' is-done' : ''}${i === stage ? ' is-active' : ''}`}
                  >
                    <span className="stage-marker" aria-hidden="true">
                      {i < stage ? (
                        <Check size={14} />
                      ) : i === stage ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    {label}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {phase === 'error' && (
            <div className="card card-pad">
              <div className="notice notice-amber">
                <ShieldCheck size={18} aria-hidden="true" />
                <p>
                  <strong>Analysis didn’t go through.</strong> {error}
                </p>
              </div>
              <div className="error-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => runAnalysis()}
                >
                  Retry analysis
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={useDemoInstead}
                >
                  Continue with demo data
                </button>
              </div>
            </div>
          )}

          <AnimatePresence>
            {phase === 'done' && result && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="results-stack"
              >
                <div className="card card-pad">
                  <div className="results-title-row">
                    <h2 className="results-title">What the Detective found</h2>
                    {result.simulated ? (
                      <SimBadge />
                    ) : (
                      <span className="pill pill-green">Live AI</span>
                    )}
                  </div>
                  <p className="results-summary">{result.summary}</p>

                  {isLive && result.analysis?.extracted_text && (
                    <div className="finding-group">
                      <h3 className="finding-title">
                        <Quote size={16} aria-hidden="true" />
                        Text in the photo
                      </h3>
                      <blockquote className="finding-quote">
                        {result.analysis.extracted_text}
                      </blockquote>
                    </div>
                  )}

                  {isLive && edits.length > 0 && (
                    <div className="finding-groups">
                      {GROUPS.map(({ kinds, title, icon: Icon }) => {
                        const rows = edits
                          .map((item, index) => ({ item, index }))
                          .filter(({ item }) =>
                            (kinds as readonly string[]).includes(item.kind),
                          );
                        if (rows.length === 0) return null;
                        return (
                          <section
                            key={title}
                            className="finding-group"
                            aria-label={title}
                          >
                            <h3 className="finding-title">
                              <Icon size={16} aria-hidden="true" />
                              {title}
                            </h3>
                            <ul className="finding-rows">
                              {rows.map(({ item, index }) => (
                                <li
                                  key={`${item.kind}-${index}`}
                                  className={`finding-row${item.confirmed ? '' : ' is-dropped'}`}
                                >
                                  <input
                                    className="input finding-input"
                                    value={item.value}
                                    onChange={(e) =>
                                      updateEdit(index, e.target.value)
                                    }
                                    aria-label={`${title} clue ${index + 1}`}
                                  />
                                  <span
                                    className={`pill ${item.origin === 'stated' ? 'pill-green' : 'pill-amber'}`}
                                    title={
                                      item.origin === 'stated'
                                        ? 'Taken from your own words'
                                        : 'Guessed by AI — please check'
                                    }
                                  >
                                    {item.origin === 'stated' ? 'You' : 'AI guess'}
                                  </span>
                                  <button
                                    type="button"
                                    className={`confirm-toggle${item.confirmed ? ' is-kept' : ''}`}
                                    aria-pressed={item.confirmed}
                                    aria-label={
                                      item.confirmed
                                        ? `Drop ${item.value}`
                                        : `Keep ${item.value}`
                                    }
                                    onClick={() => toggleEdit(index)}
                                  >
                                    <Check size={15} aria-hidden="true" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
                  )}

                  {isLive && userInputs.length > 0 && (
                    <div className="finding-group">
                      <h3 className="finding-title">
                        <ScrollText size={16} aria-hidden="true" />
                        Your memories
                      </h3>
                      <ul className="finding-tags">
                        {userInputs.map((u) => (
                          <li key={u.label} className="finding-tag">
                            <span>{u.value}</span>
                            <span className="pill pill-green">You</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {isLive &&
                    result.analysis &&
                    (result.analysis.uncertain_observations.length > 0 ||
                      result.analysis.possible_context) && (
                      <div className="finding-group">
                        <h3 className="finding-title">
                          <ShieldCheck size={16} aria-hidden="true" />
                          Uncertain — needs your check
                        </h3>
                        <ul className="finding-uncertain">
                          {result.analysis.possible_context && (
                            <li>
                              Possible context:{' '}
                              {result.analysis.possible_context}
                            </li>
                          )}
                          {result.analysis.uncertain_observations.map((u) => (
                            <li key={u}>{u}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {isLive && edits.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-primary btn-block"
                      disabled={confirming || edits.every((e) => !e.confirmed)}
                      onClick={() => runMatches(edits)}
                    >
                      {confirming ? (
                        <>
                          <LoaderCircle
                            size={16}
                            className="spin"
                            aria-hidden="true"
                          />
                          Finding matches…
                        </>
                      ) : (
                        'Confirm & find matches'
                      )}
                    </button>
                  )}
                </div>

                {isLive && (
                  <div className="card card-pad">
                    <div className="results-title-row">
                      <h2 className="results-title">
                        <BookmarkPlus size={19} aria-hidden="true" />
                        Save as a memory
                      </h2>
                      <span className="pill pill-neutral">Private</span>
                    </div>
                    {!user ? (
                      <p className="results-note">
                        <Link to="/signup">Create an account</Link> or{' '}
                        <Link to="/login">sign in</Link> to save these
                        confirmed clues as a private memory. Nothing is
                        published automatically.
                      </p>
                    ) : savedId ? (
                      <p className="results-note">
                        Saved to your private memories.{' '}
                        <Link to="/app/profile">View on your profile</Link>
                      </p>
                    ) : (
                      <>
                        <p className="results-note">
                          Only your confirmed clues are saved — privately.
                          Your photo stays private too unless you share the
                          memory later.
                        </p>
                        <label className="field">
                          <span className="field-label">
                            Memory title (optional)
                          </span>
                          <input
                            className="input"
                            placeholder="e.g. Sports day trophy mystery"
                            value={saveTitle}
                            onChange={(e) => setSaveTitle(e.target.value)}
                            maxLength={200}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-outline btn-block"
                          disabled={saving}
                          onClick={() => saveAsMemory()}
                        >
                          {saving ? (
                            <>
                              <LoaderCircle
                                size={16}
                                className="spin"
                                aria-hidden="true"
                              />
                              Saving…
                            </>
                          ) : (
                            <>
                              <BookmarkPlus size={16} aria-hidden="true" />
                              Save privately
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                )}

                <div className="card card-pad">
                  <div className="results-title-row">
                    <h2 className="results-title">People you may remember</h2>
                    {result.simulated && <SimBadge label="Demo" />}
                  </div>
                  {isLive ? (
                    <>
                      <p className="results-note">{matchNote}</p>
                      {confirming && matches === null ? (
                        <ul className="matches-grid" aria-label="Loading matches">
                          {[0, 1, 2].map((i) => (
                            <li key={i} className="card conn-skeleton" aria-hidden="true">
                              <span className="skeleton skeleton-avatar" />
                              <span className="skeleton skeleton-line" style={{ width: '60%' }} />
                              <span className="skeleton skeleton-line" style={{ width: '85%' }} />
                            </li>
                          ))}
                        </ul>
                      ) : matches !== null && matches.length === 0 ? (
                        <div className="matches-empty">
                          <Users size={26} strokeWidth={1.5} aria-hidden="true" />
                          <p>
                            <strong>No overlaps found yet.</strong>
                            <span>
                              Confirm more clues above, or add a school, year,
                              or nickname to widen the search.
                            </span>
                          </p>
                        </div>
                      ) : matches === null ? (
                        <div className="matches-empty">
                          <Users size={26} strokeWidth={1.5} aria-hidden="true" />
                          <p>
                            <strong>No search ran yet.</strong>
                            <span>
                              Confirm the clues above to search for people
                              who share them.
                            </span>
                          </p>
                        </div>
                      ) : (
                        <ul className="matches-grid">
                          {liveCards.map((m) => (
                            <ConnectionCard key={m.id} match={m} />
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="results-note">
                        Demonstration suggestions — connect the backend to
                        match against real people who opted in.
                      </p>
                      <ul className="matches-grid">
                        {demoCards.map((m) => (
                          <ConnectionCard key={m.id} match={m} />
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                {isLive && (
                  <div className="card card-pad">
                    <div className="results-title-row">
                      <h2 className="results-title">
                        <Images size={19} aria-hidden="true" />
                        Related community memories
                      </h2>
                      <SimBadge label="Demo fixtures" />
                    </div>
                    {discover === null ? (
                      <p className="results-note">
                        {confirming
                          ? 'Finding related memories…'
                          : discNote ||
                            'Community memories appear here after matching.'}
                      </p>
                    ) : discover.length === 0 ? (
                      <p className="results-note">
                        No community memories match these clues yet.
                      </p>
                    ) : (
                      <>
                        <ul className="disc-rail no-scrollbar">
                          {discover.map((d, i) => (
                            <li key={d.id} className="disc-card">
                              <button
                                type="button"
                                className="disc-art"
                                onClick={() => setDiscZoom(i)}
                                aria-label={`Open ${d.title}`}
                              >
                                <MemoryArt seed={d.seed} label={d.year ?? ''} />
                              </button>
                              <p className="disc-title">{d.title}</p>
                              <p className="disc-author">by {d.author}</p>
                              <div className="disc-pills">
                                {d.school && (
                                  <span className="pill pill-indigo">{d.school}</span>
                                )}
                                {d.place && (
                                  <span className="pill pill-neutral">{d.place}</span>
                                )}
                                {d.year && (
                                  <span className="pill pill-neutral">{d.year}</span>
                                )}
                              </div>
                              {d.reasons[0] && (
                                <p className="disc-why">{d.reasons[0]}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                        <p className="results-note disc-note">{discNote}</p>
                      </>
                    )}
                  </div>
                )}

                {backendUp && photoFile !== null && (rescueNeeded || rescueOpen) && (
                  <MemoryRescue
                    coveredKinds={coveredKinds}
                    photoUrl={photoUrl}
                    foundResults={
                      liveCards.length > 0 || (discover?.length ?? 0) > 0
                    }
                    contextSummary={result?.summary ?? ''}
                    onRescued={handleRescued}
                  />
                )}
                {backendUp &&
                  photoFile !== null &&
                  !rescueNeeded &&
                  !rescueOpen && (
                    <button
                      type="button"
                      className="btn btn-outline btn-block"
                      onClick={() => setRescueOpen(true)}
                    >
                      <LifeBuoy size={16} aria-hidden="true" />
                      Want help digging deeper? Start Memory Rescue
                    </button>
                  )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {photoUrl && (
        <MediaLightbox
          seeds={[]}
          photos={[{ src: photoUrl, label: 'Your uploaded childhood photo' }]}
          index={zoom}
          onClose={() => setZoom(-1)}
          onIndex={setZoom}
          label="Uploaded photo zoom"
        />
      )}
      {discover && discover.length > 0 && (
        <MediaLightbox
          seeds={discover.map((d) => d.seed)}
          index={discZoom}
          onClose={() => setDiscZoom(-1)}
          onIndex={setDiscZoom}
          label="Community memory"
        />
      )}
    </div>
  );
}
