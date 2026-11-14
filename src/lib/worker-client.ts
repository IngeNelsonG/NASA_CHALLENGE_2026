import type { WorkerApi } from './data.worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./data.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.ok) p.resolve(e.data.result as never);
    else p.reject(new Error(e.data.error ?? 'worker error'));
  };
  return worker;
}

/** Typed RPC into the data worker. */
export function callWorker<K extends keyof WorkerApi>(type: K, payload: Parameters<WorkerApi[K]>[0]): Promise<ReturnType<WorkerApi[K]>> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    get().postMessage({ id, type, payload });
  });
}

export async function downloadCsv(req: Parameters<WorkerApi['csv']>[0], filename: string) {
  const text = await callWorker('csv', req);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
