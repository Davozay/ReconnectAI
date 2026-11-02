import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  LifeBuoy,
  LoaderCircle,
  Send,
  SkipForward,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import SearchPostModal from './SearchPostModal';
import type { SearchPost } from './SearchPostModal';
import { useToast } from '../context/useToast';
import {
  ApiError,
  getRescueQuestion,
  sendRescueAnswer,
} from '../lib/api';
import type {
  ConfirmedItem,
  ExtractionItem,
  RescueAnswerGiven,
  RescueQuestion,
  RescueScene,
} from '../lib/api';
import './MemoryRescue.css';

interface ChatEntry {
  id: string;
  prompt: string;
  answer: string;
}

export default function MemoryRescue({
  coveredKinds,
  photoUrl,
  foundResults,
  contextSummary,
  onRescued,
}: {
  coveredKinds: string[];
  photoUrl: string | null;
  foundResults: boolean;
  contextSummary: string;
  onRescued: (items: ConfirmedItem[], scene: RescueScene) => void;
}) {
  const [started, setStarted] = useState(false);
  const [question, setQuestion] = useState<RescueQuestion | null>(null);
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<ChatEntry[]>([]);
  const [answers, setAnswers] = useState<RescueAnswerGiven[]>([]);
  const [rescued, setRescued] = useState<ExtractionItem[]>([]);
  const [scene, setScene] = useState<RescueScene>({ objects: [], setting: '' });
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [postSession, setPostSession] = useState(0);
  const [posts, setPosts] = useState<SearchPost[]>([]);
  const { toast } = useToast();

  const openPostComposer = () => {
    setPostSession((s) => s + 1);
    setPostOpen(true);
  };

  const fetchNext = async (given: RescueAnswerGiven[]) => {
    setLoading(true);
    setError('');
    try {
      const res = await getRescueQuestion(coveredKinds, given);
      setMessage(res.message);
      if (res.done || !res.question) {
        setDone(true);
        setQuestion(null);
      } else {
        setQuestion(res.question);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the next question.');
    } finally {
      setLoading(false);
    }
  };

  const start = () => {
    setStarted(true);
    void fetchNext([]);
  };

  const submit = async (
    value: string,
    opts: { skipped?: boolean; unknown?: boolean } = {},
  ) => {
    if (!question || loading) return;
    const given: RescueAnswerGiven = {
      topic: question.topic,
      value: value.trim(),
      skipped: opts.skipped ?? false,
      unknown: opts.unknown ?? false,
    };
    setLoading(true);
    setError('');
    try {
      const res = await sendRescueAnswer(question.topic, given.value, opts);
      const nextAnswers = [...answers, given];
      setAnswers(nextAnswers);
      setHistory((prev) => [
        ...prev,
        {
          id: question.id,
          prompt: question.prompt,
          answer: given.skipped
            ? 'Skipped'
            : given.unknown
              ? "I don't remember"
              : given.value,
        },
      ]);
      if (res.items.length > 0) {
        setRescued((prev) => [...prev, ...res.items]);
      }
      if (question.topic === 'scene' && given.value && !given.skipped && !given.unknown) {
        const objects = given.value
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8);
        setScene((prev) => ({ ...prev, objects: [...prev.objects, ...objects] }));
      }
      setDraft('');
      await fetchNext(nextAnswers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save that answer.');
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) void submit(draft);
  };

  const search = () => {
    const items: ConfirmedItem[] = rescued.map((item) => ({
      kind: item.kind,
      value: item.value,
      confirmed: true,
    }));
    setSearched(true);
    onRescued(items, scene);
  };

  if (!started) {
    return (
      <div className="card card-pad rescue-prompt">
        {photoUrl && (
          <img src={photoUrl} alt="" aria-hidden="true" className="rescue-thumb" />
        )}
        <div className="rescue-prompt-body">
          <h2 className="results-title">
            <LifeBuoy size={19} aria-hidden="true" />
            This photo needs Memory Rescue
          </h2>
          <p className="results-note">
            I couldn’t find readable text or clear clues in it — but your
            memories can fill the gaps. Answer a few friendly questions and
            I’ll search with what we learn together.
          </p>
          <button type="button" className="btn btn-primary" onClick={start}>
            <Sparkles size={16} aria-hidden="true" />
            Start Memory Rescue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card card-pad rescue-chat" aria-live="polite">
      <div className="rescue-head">
        <span className="rescue-avatar" aria-hidden="true">
          <Sparkles size={18} />
        </span>
        <div>
          <h2 className="results-title">Memory Rescue</h2>
          <p className="rescue-progress">
            {done
              ? 'All questions answered'
              : `${answers.length} answered · skip anything you don’t remember`}
          </p>
        </div>
      </div>

      {history.length > 0 && (
        <ul className="rescue-history">
          {history.map((h) => (
            <li key={h.id} className="rescue-turn">
              <p className="rescue-q">{h.prompt}</p>
              <p className="rescue-a">{h.answer}</p>
            </li>
          ))}
        </ul>
      )}

      {!done && message && <p className="rescue-message">{message}</p>}

      {error && (
        <div className="notice notice-amber rescue-error">
          <HelpCircle size={16} aria-hidden="true" />
          <p>{error}</p>
        </div>
      )}

      {!done && question && (
        <div className="rescue-ask">
          <p className="rescue-prompt-text">{question.prompt}</p>
          <p className="rescue-hint">{question.hint}</p>
          <form onSubmit={onSubmit} className="rescue-form">
            <input
              className="input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={question.placeholder}
              aria-label={question.prompt}
              disabled={loading}
            />
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={loading || !draft.trim()}
            >
              {loading ? (
                <LoaderCircle size={15} className="spin" aria-hidden="true" />
              ) : (
                <Send size={15} aria-hidden="true" />
              )}
              Answer
            </button>
          </form>
          <div className="rescue-skips">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={loading}
              onClick={() => void submit('', { skipped: true })}
            >
              <SkipForward size={14} aria-hidden="true" />
              Skip
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={loading}
              onClick={() => void submit('', { unknown: true })}
            >
              <HelpCircle size={14} aria-hidden="true" />I don’t remember
            </button>
          </div>
        </div>
      )}

      {loading && !question && !done && (
        <p className="results-note">
          <LoaderCircle size={14} className="spin" aria-hidden="true" />{' '}
          Thinking of a good question…
        </p>
      )}

      {rescued.length > 0 && (
        <div className="rescue-found">
          <h3 className="finding-title">Rescued clues</h3>
          <ul className="finding-tags">
            {rescued.map((item, i) => (
              <li key={`${item.kind}-${item.value}-${i}`} className="finding-tag">
                <span>{item.value}</span>
                <span className="pill pill-green">{item.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {done && (
        <div className="rescue-done">
          <p className="results-note">{message}</p>
          {rescued.length === 0 ? (
            <p className="results-note">
              No usable clues came out of that — but you can still post this
              photo and ask the community for help.
            </p>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block"
              disabled={searched}
              onClick={search}
            >
              {searched ? 'Searching…' : `Search with ${rescued.length} rescued clues`}
            </button>
          )}
          {(!foundResults || rescued.length === 0) && (
            <button
              type="button"
              className="btn btn-outline btn-block"
              onClick={openPostComposer}
            >
              Create a Memory Search Post
            </button>
          )}
          {posts.length > 0 && (
            <p className="results-note">
              {posts.length} search {posts.length === 1 ? 'post' : 'posts'} saved
              on this device.
            </p>
          )}
        </div>
      )}

      <SearchPostModal
        key={postSession}
        open={postOpen}
        onClose={() => setPostOpen(false)}
        photoUrl={photoUrl}
        captionSeed={contextSummary}
        onPublished={(post) => {
          setPosts((prev) => [post, ...prev]);
          setPostOpen(false);
          toast('Search post saved on this device');
        }}
      />
    </div>
  );
}
