import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { useT } from '@/app/i18n';
import { api } from '@/lib/api';
import type { AOI } from '@/lib/types';
import { useStore } from '@/store';

/** Accessible combobox over GET /api/aoi/search. */
export function AoiSearch({ onSelect, compact = false }: { onSelect?: (aoi: AOI) => void; compact?: boolean }) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const h = setTimeout(() => setQ(text), 180);
    return () => clearTimeout(h);
  }, [text]);

  const { data = [], isFetching, isError } = useQuery({
    queryKey: ['aoi-search', q],
    queryFn: ({ signal }) => api.searchAoi(q, signal),
    enabled: open,
  });

  const choose = (aoi: AOI) => {
    useStore.getState().setAoi(aoi);
    setText('');
    setOpen(false);
    onSelect?.(aoi);
  };

  return (
    <div className="relative" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <label htmlFor={id} className={compact ? 'sr-only' : 'mb-1 block text-xs text-ink-dim'}>
        {t('aoi.search_label')}
      </label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && data[active] ? `${id}-opt-${active}` : undefined}
        autoComplete="off"
        placeholder={t('aoi.search_ph')}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setOpen(true), setActive((a) => Math.min(data.length - 1, a + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === 'Enter' && open && data[active]) (e.preventDefault(), choose(data[active]));
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul id={`${id}-list`} role="listbox" className="panel absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-auto p-1">
          {data.map((a, i) => (
            <li
              key={a.id}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(a)}
              className={`flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-sm ${i === active ? 'bg-graphite-600 text-ink' : 'text-ink-dim'}`}
            >
              <span>{a.name}</span>
              <span className="data shrink-0 text-xs text-ink-mute">
                {a.bbox[1].toFixed(1)}, {a.bbox[0].toFixed(1)}
              </span>
            </li>
          ))}
          {!data.length && (
            <li className="px-2.5 py-2 text-sm text-ink-mute" role="status">
              {isError ? t('common.error') : isFetching ? t('aoi.searching') : t('aoi.none')}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
