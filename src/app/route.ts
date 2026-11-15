import { useSyncExternalStore } from 'react';

/**
 * Two pages, no router library: the landing at `/` and the methodology page at `/metodologia`.
 * Same-origin links starting with `/` are handled in place (see `onLinkClick`), so moving between
 * them keeps the loaded data and the globe; a direct visit works through the rewrite in vercel.json.
 */
export const METHOD_PATH = '/metodologia';

const listeners = new Set<() => void>();
const isMethod = () => location.pathname.replace(/\/+$/, '') === METHOD_PATH;

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
}

export const useIsMethodPage = () => useSyncExternalStore(subscribe, isMethod);
export const onMethodPage = isMethod;

/** A landing section from either page: `#id` on the landing, `/#id` from the methodology page. */
export const sectionHref = (id: string, method: boolean) => (method ? `/#${id}` : `#${id}`);

export function go(href: string) {
  history.pushState(null, '', href);
  listeners.forEach((fn) => fn());
}

/** Document-level click handler: in-app links (`/…`) switch page without a reload. */
export function onLinkClick(e: MouseEvent) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.('a');
  const href = a?.getAttribute('href');
  if (!a || !href || !href.startsWith('/') || href.startsWith('//') || a.target || a.hasAttribute('download')) return;
  e.preventDefault();
  go(href);
}

/** After a page switch: land on the `#section` asked for (it may still be mounting), else the top. */
export function scrollAfterSwitch() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) {
    window.scrollTo({ top: 0 });
    return;
  }
  // The page above the target is still laying out (lazy sections, fonts), so a smooth scroll would
  // stop short: jump, and jump again until the target holds still for ~10 frames (max ~2 s).
  let tries = 0;
  let still = 0;
  const seek = () => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top;
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      still = Math.abs(el.getBoundingClientRect().top - top) < 1 ? still + 1 : 0;
      if (still >= 10) return;
    }
    if (++tries < 120) requestAnimationFrame(seek);
  };
  seek();
}
