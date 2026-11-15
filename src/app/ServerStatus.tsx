import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { USE_MOCKS } from '@/lib/env';
import { useT } from './i18n';

/** Wait this long before telling the visitor the server is still waking up. */
const SLOW_MS = 3500;

/**
 * The API runs as a serverless function: after a quiet spell the first request starts it (a few
 * seconds). This pings a light endpoint on load and, only if it is slow or fails, shows a small
 * note so the page does not just look empty.
 */
export function ServerStatus() {
  const t = useT();
  const [state, setState] = useState<'ok' | 'waking' | 'down'>('ok');
  const [attempt, setAttempt] = useState(0);
  const qc = useQueryClient();
  const wasSlow = useRef(false);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (USE_MOCKS) return;
    let alive = true;
    const slow = window.setTimeout(() => {
      wasSlow.current = true;
      if (alive) setState('waking');
    }, SLOW_MS);
    apiFetch('/api/satellites/tle')
      .then(() => {
        if (!alive) return;
        setState('ok');
        // requests made while the server was asleep gave up: ask again now that it answers
        if (wasSlow.current) void qc.refetchQueries({ predicate: (q) => q.state.status === 'error' });
        wasSlow.current = false;
      })
      .catch(() => {
        wasSlow.current = true;
        if (alive) setState('down');
      })
      .finally(() => clearTimeout(slow));
    return () => {
      alive = false;
      clearTimeout(slow);
    };
  }, [attempt, qc]);

  if (state === 'ok') return null;
  return (
    <div role="status" className="panel fade-in fixed bottom-20 left-4 z-50 flex max-w-[min(22rem,calc(100vw-2rem))] items-start gap-3 p-3 text-xs leading-relaxed text-ink sm:bottom-6 sm:left-6">
      {state === 'waking' ? (
        <span aria-hidden className="mt-0.5 h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-cream/30 border-t-cream" />
      ) : (
        <span aria-hidden className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sev-critical" />
      )}
      <p className="min-w-0">
        {t(state === 'waking' ? 'api.waking' : 'api.down')}
        {state === 'down' && (
          <button type="button" className="tap ml-1.5 font-semibold underline underline-offset-4 hover:text-cream" onClick={retry}>
            {t('common.retry')}
          </button>
        )}
      </p>
    </div>
  );
}
