import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fmtMonth, useT, type Key } from '@/app/i18n';
import { SectionHeading, Spinner } from '@/components/ui';
import { RECORD_START, USE_MOCKS } from '@/lib/env';
import { todayIso } from '@/lib/geo';
import { streamAnalyst } from '@/lib/sse';
import { useStore } from '@/store';

const SUGGESTIONS: Key[] = ['analyst.q1', 'analyst.q2', 'analyst.q3'];

/** Chat-style front end for POST /api/analyst (backend proxy to Claude, SSE streaming). */
export function Analyst() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const series = useStore((s) => s.series);
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
        { aoiId: aoi.id, question: q, lang, context: { from: RECORD_START, to: todayIso(), sensor: series } },
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
  const openHighlight = (date: string) => {
    useStore.getState().set({ date, resolution: 'month' });
    document.getElementById('calendar')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="analyst" className="section" aria-labelledby="analyst-title">
      <SectionHeading id="analyst-title" eyebrow={t('analyst.eyebrow')} title={t('analyst.title')} lead={t('analyst.lead', { aoi: aoi.name })} />
      <div className="panel mx-auto max-w-3xl p-4 sm:p-5 lg:mx-0">
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((k) => (
            <button key={k} type="button" className="chip min-h-[32px] hover:border-brand-yonder/60 hover:text-ink" disabled={status === 'streaming'} onClick={() => void ask(t(k))}>
              {t(k)}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[9rem] rounded-lg border border-line bg-space-900/70 p-4" aria-live="polite" aria-busy={status === 'streaming'}>
          {status === 'idle' && <p className="text-sm text-ink-mute">{t('analyst.empty')}</p>}
          {asked && <p className="mb-3 text-sm font-semibold text-ink">› {asked}</p>}
          {answer && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
              {answer}
              {status === 'streaming' && <span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-brand-yonder" />}
            </p>
          )}
          {status === 'streaming' && !answer && <Spinner label={t('analyst.thinking')} />}
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
              <p className="text-xs text-ink-dim">{t('analyst.highlights')}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {highlights.map((h) => (
                  <li key={h.date}>
                    <button type="button" className="chip min-h-[32px] border-brand-yellow/50 text-ink hover:border-brand-yellow" title={h.reason} onClick={() => openHighlight(h.date)}>
                      <span className="data">{fmtMonth(h.date, lang)}</span>
                      {h.reason && <span className="text-ink-dim">· {h.reason}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="mt-3 flex gap-2">
          <label htmlFor="analyst-q" className="sr-only">
            {t('analyst.input_label')}
          </label>
          <input id="analyst-q" className="input" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('analyst.placeholder')} maxLength={400} autoComplete="off" />
          {status === 'streaming' ? (
            <button type="button" className="btn" onClick={() => (abort.current?.abort(), setStatus(answer ? 'done' : 'idle'))}>
              {t('analyst.stop')}
            </button>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={!question.trim()}>
              {t('analyst.ask')}
            </button>
          )}
        </form>
        <p className="mt-3 text-xs leading-relaxed text-ink-mute">
          {t('analyst.disclaimer')} {USE_MOCKS && t('analyst.mock')}
        </p>
      </div>
    </section>
  );
}
