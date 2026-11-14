import { apiFetch } from './api';
import type { AnalystHighlight, AnalystRequest } from './types';

/**
 * POST /api/analyst — reads the SSE stream.
 * Accepted `data:` payloads:
 *   {"delta":"text"} | {"text":"text"}   → appended to the answer
 *   {"highlights":[{date,reason}]}       → final payload, ends the stream
 *   [DONE]                               → ignored
 *   anything that is not JSON            → appended verbatim
 */
export async function streamAnalyst(
  req: AnalystRequest,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<AnalystHighlight[]> {
  const res = await apiFetch('/api/analyst', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.body) throw new Error('No response body');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let highlights: AnalystHighlight[] = [];

  const handle = (event: string) => {
    const data = event
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || data === '[DONE]') return;
    try {
      const j = JSON.parse(data) as { delta?: string; text?: string; highlights?: AnalystHighlight[] };
      if (Array.isArray(j.highlights)) highlights = j.highlights;
      else if (typeof j.delta === 'string') onDelta(j.delta);
      else if (typeof j.text === 'string') onDelta(j.text);
    } catch {
      onDelta(data);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 2);
    }
  }
  if (buf.trim()) handle(buf);
  return highlights;
}
