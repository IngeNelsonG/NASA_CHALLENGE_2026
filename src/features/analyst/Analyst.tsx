import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fmtMonth, useT, type Key } from '@/app/i18n';
import { SectionHeading, Spinner } from '@/components/ui';
import { USE_MOCKS } from '@/lib/env';
import { streamAnalyst } from '@/lib/sse';
import { useStore } from '@/store';

const SUGGESTIONS: Key[] = ['analyst.q1', 'analyst.q2', 'analyst.q3'];

/** Progressively parse streamed analyst text into title, bullets, and closing note. */
function AnalystAnswer({ text, streaming }: { text: string; streaming: boolean }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let title = '';
  const intro: string[] = [];
  const bullets: string[] = [];
  const closing: string[] = [];
  let seenBullet = false;

  for (const line of lines) {
    if (line.startsWith('•')) {
      seenBullet = true;
      bullets.push(line.replace(/^•\s*/, ''));
    } else if (!seenBullet) {
      if (!title) title = line;
      else intro.push(line);
    } else {
      closing.push(line);
    }
  }

  const cursor = streaming ? (
    <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-accent" />
  ) : null;
  const cursorTarget: 'closing' | 'bullet' | 'intro' | 'title' = closing.length
    ? 'closing'
    : bullets.length
      ? 'bullet'
      : intro.length
        ? 'intro'
        : 'title';

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-ink">
      {title && (
        <p className="font-semibold text-ink">
          {title}
          {cursorTarget === 'title' && cursor}
        </p>
      )}
      {intro.map((line, i) => (
        <p key={i} className="text-xs leading-relaxed text-ink-dim">
          {line}
          {cursorTarget === 'intro' && i === intro.length - 1 && cursor}
        </p>
      ))}
      {bullets.length > 0 && (
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink">
          {bullets.map((b, i) => (
            <li key={i}>
              {b}
              {cursorTarget === 'bullet' && i === bullets.length - 1 && cursor}
            </li>
          ))}
        </ul>
      )}
      {closing.map((line, i) => (
        <p key={i} className="pt-1 text-xs leading-relaxed text-ink-mute">
          {line}
          {cursorTarget === 'closing' && i === closing.length - 1 && cursor}
        </p>
      ))}
    </div>
  );
}

/** Chat-style front end for POST /api/analyst (deterministic FIRMS SSE streaming). */
export function Analyst() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const calRange = useStore((s) => s.calRange);
  const highlights = useStore((s) => s.highlights);
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState('');
  const [status, setStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  // a new AOI invalidates the previous answer
  useEffect(() => {
    abort.current?.abort();
    setAnswer('');
    setAsked('');
    setStatus('idle');
  }, [aoi.id]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || status === 'streaming') return;
    abort.current?.abort();
    const ctrl = (abort.current = new AbortController());
    setAsked(q);
    setAnswer('');
    setQuestion('');
    setStatus('streaming');
    try {
      const hl = await streamAnalyst(
        { aoiId: aoi.id, question: q, lang, context: { from: calRange.from, to: calRange.to, sensor: 'harmonized' } },
        (delta) => setAnswer((a) => a + delta),
        ctrl.signal,
      );
      useStore.getState().set({ highlights: hl });
      setStatus('done');
    } catch (e) {
      if (ctrl.signal.aborted) return;
      console.error(e);
      setStatus('error');
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };
  const openHighlight = (date: string) => useStore.getState().revealOnCalendar(date);

  return (
    <section id="analyst" className="section" aria-labelledby="analyst-title">
      <SectionHeading id="analyst-title" eyebrow={t('analyst.eyebrow')} title={t('analyst.title')} lead={t('analyst.lead', { aoi: aoi.name })} />

      <div className="panel mx-auto flex max-w-[760px] flex-col overflow-hidden">
        {/* Horizontal row of suggested questions */}
        <div
          role="region"
          aria-label={t('analyst.suggestions_aria')}
          className="flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-3 sm:px-5"
        >
          {SUGGESTIONS.map((k) => (
            <button
              key={k}
              type="button"
              className="chip-btn shrink-0 whitespace-nowrap"
              disabled={status === 'streaming'}
              onClick={() => void ask(t(k))}
            >
              {t(k)}
            </button>
          ))}
        </div>

        {/* Chat message thread */}
        <div
          className="flex min-h-[15rem] flex-1 flex-col justify-start space-y-4 p-4 sm:p-6"
          aria-live="polite"
          aria-busy={status === 'streaming'}
        >
          {status === 'idle' && !asked && (
            <p className="my-auto text-center text-sm text-ink-mute">{t('analyst.empty')}</p>
          )}

          {asked && (
            <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-graphite-700 px-4 py-2.5 text-sm text-ink">
              {asked}
            </div>
          )}

          {status !== 'idle' && (
            <div className="rounded-2xl rounded-tl-sm border border-line/70 bg-graphite-900/70 p-4 sm:p-5">
              {status === 'streaming' && !answer && <Spinner label={t('analyst.thinking')} />}
              {answer && <AnalystAnswer text={answer} streaming={status === 'streaming'} />}
              {status === 'error' && (
                <p role="alert" className="text-sm text-ink">
                  {t('analyst.error')}{' '}
                  <button type="button" className="underline" onClick={() => void ask(asked)}>
                    {t('common.retry')}
                  </button>
                </p>
              )}

              {status === 'done' && highlights.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-xs font-medium text-ink-dim">{t('analyst.highlights')}</p>
                  <ul className="mt-2 divide-y divide-line/60">
                    {highlights.map((h) => (
                      <li key={h.date} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0 text-xs">
                        <div className="min-w-0">
                          <span className="data font-semibold text-ink">{fmtMonth(h.date, lang)}</span>
                          {h.reason && <span className="ml-2 text-ink-dim">{h.reason}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => openHighlight(h.date)}
                          className="shrink-0 font-medium text-accent underline-offset-2 hover:underline"
                        >
                          {t('analyst.view_on_cal')} →
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input pinned at the bottom of the panel */}
        <form onSubmit={onSubmit} className="flex gap-2 border-t border-line bg-graphite-900/80 p-3 sm:px-5 sm:py-3.5">
          <label htmlFor="analyst-q" className="sr-only">
            {t('analyst.input_label')}
          </label>
          <input
            id="analyst-q"
            className="input min-w-0"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('analyst.placeholder')}
            maxLength={400}
            autoComplete="off"
          />
          {status === 'streaming' ? (
            <button
              type="button"
              className="btn shrink-0"
              onClick={() => (abort.current?.abort(), setStatus(answer ? 'done' : 'idle'))}
            >
              {t('analyst.stop')}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary shrink-0" disabled={!question.trim()}>
              {t('analyst.ask')}
            </button>
          )}
        </form>
      </div>

      <p className="mx-auto mt-3 max-w-[760px] text-xs leading-relaxed text-ink-mute">
        {t('analyst.disclaimer')} {USE_MOCKS && t('analyst.mock')}
      </p>
    </section>
  );
}
