import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fmtMonth, useT, type Key } from '@/app/i18n';
import { Spinner } from '@/components/ui';
import { streamAnalyst } from '@/lib/sse';
import type { AnalystHighlight } from '@/lib/types';
import { useStore } from '@/store';

const SUGGESTIONS: Key[] = ['assistant.q1', 'assistant.q2', 'assistant.q3', 'assistant.q4'];
/** Earlier turns sent with each question (the server accepts up to 8). */
const HISTORY = 8;

type Msg = { role: 'user' | 'assistant'; content: string; highlights?: AnalystHighlight[]; error?: boolean };

/** Help chat behind a floating button on the right: how to use the page and what its data means. */
export function Assistant() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const picked = useStore((s) => !!s.picked);
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    thread.current?.scrollTo({ top: thread.current.scrollHeight });
  }, [msgs]);

  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = msgs.filter((m) => !m.error && m.content).slice(-HISTORY).map(({ role, content }) => ({ role, content }));
    const ctrl = (abort.current = new AbortController());
    setQuestion('');
    setBusy(true);
    setMsgs((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '' }]);
    const patch = (f: (m: Msg) => Msg) => setMsgs((all) => [...all.slice(0, -1), f(all[all.length - 1])]);
    try {
      const highlights = await streamAnalyst(
        { aoiId: aoi.id, question: q, lang, history },
        (delta) => patch((m) => ({ ...m, content: m.content + delta })),
        ctrl.signal,
      );
      patch((m) => ({ ...m, highlights }));
      if (highlights.length) useStore.getState().set({ highlights });
    } catch {
      if (!ctrl.signal.aborted) patch((m) => ({ ...m, error: true }));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <>
      {open && (
        <div
          id="assistant-panel"
          role="dialog"
          aria-labelledby="assistant-title"
          onKeyDown={(e) => e.key === 'Escape' && close()}
          className="panel assistant-in fixed inset-x-3 bottom-[5.25rem] z-50 flex h-[min(600px,calc(100svh-6.5rem))] flex-col overflow-hidden bg-graphite-900 backdrop-blur-none sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-[24rem]"
        >
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0">
              <h2 id="assistant-title" className="card-title">
                {t('assistant.title')}
              </h2>
              <p className="mt-0.5 text-xs text-ink-dim">{t('assistant.lead', { aoi: aoi.name })}</p>
            </div>
            <button type="button" className="btn btn-icon shrink-0" onClick={close} aria-label={t('assistant.close')}>
              <span aria-hidden>✕</span>
            </button>
          </header>

          <div ref={thread} className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite" aria-busy={busy}>
            {msgs.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-ink-dim">{t('assistant.empty')}</p>
                <div className="flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((k) => (
                    <button key={k} type="button" className="chip-btn text-left" onClick={() => void ask(t(k))}>
                      {t(k)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === 'user' ? (
                <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-graphite-700 px-3.5 py-2 text-sm text-ink">
                  {m.content}
                </p>
              ) : (
                <div key={i} className="max-w-[92%] rounded-2xl rounded-tl-sm border border-line/70 bg-graphite-900/70 px-3.5 py-2.5 text-sm leading-relaxed text-ink">
                  {m.error ? (
                    <p role="alert">{t('assistant.error')}</p>
                  ) : m.content ? (
                    <p className="whitespace-pre-line">{m.content}</p>
                  ) : (
                    <Spinner label={t('assistant.thinking')} />
                  )}
                  {!!m.highlights?.length && (
                    <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
                      {m.highlights.map((h) => (
                        <li key={h.date}>
                          <button type="button" className="tap inline-flex items-center gap-1 font-semibold text-accent underline-offset-2 hover:underline" onClick={() => useStore.getState().revealOnCalendar(h.date)}>
                            {`${fmtMonth(h.date, lang)} · ${t('assistant.view_on_cal')} →`}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ),
            )}
          </div>

          <form onSubmit={onSubmit} className="flex gap-2 border-t border-line bg-graphite-900/80 p-3">
            <label htmlFor="assistant-q" className="sr-only">
              {t('assistant.input_label')}
            </label>
            <input
              ref={input}
              id="assistant-q"
              className="input min-w-0"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={t('assistant.placeholder')}
              maxLength={500}
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={!question.trim() || busy}>
              {t('assistant.send')}
            </button>
          </form>
          <p className="px-4 pb-3 text-[11px] leading-snug text-ink-mute">{t('assistant.disclaimer')}</p>
        </div>
      )}

      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls="assistant-panel"
        aria-label={open ? t('assistant.close') : t('assistant.open')}
        onClick={() => (open ? close() : setOpen(true))}
        className={`btn btn-primary fixed bottom-4 right-4 z-50 h-14 min-w-14 rounded-full !px-4 shadow-panel sm:bottom-6 sm:right-6 ${picked && !open ? 'max-sm:hidden' : ''}`}
      >
        <span aria-hidden className="text-lg leading-none">
          {open ? '✕' : '?'}
        </span>
        {!open && <span className="hidden sm:inline">{t('assistant.fab')}</span>}
      </button>
    </>
  );
}
