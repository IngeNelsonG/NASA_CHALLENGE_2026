import { useEffect } from 'react';
import { fmtDay, fmtInt, fmtMonth, useT } from '@/app/i18n';
import { Segmented, Spinner } from '@/components/ui';
import { HOTSPOT_COLOR } from '@/lib/colors';
import { dayIdx, daysInYear, isoDay, todayIso, yearStartIdx } from '@/lib/geo';
import { useStore, type Granularity } from '@/store';
import { useData } from '@/store/data';

const Y0 = 2000;

/** Slider model per granularity: index ↔ ISO date. */
function model(g: Granularity, date: string) {
  const today = todayIso();
  const ty = +today.slice(0, 4), tm = +today.slice(5, 7);
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  if (g === 'year') {
    return { min: 0, max: ty - Y0, value: y - Y0, toDate: (i: number) => `${Y0 + i}-01-01` };
  }
  if (g === 'month') {
    return {
      min: 0,
      max: (ty - Y0) * 12 + tm - 1,
      value: (y - Y0) * 12 + m - 1,
      toDate: (i: number) => `${Y0 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`,
    };
  }
  const start = yearStartIdx(y);
  const max = Math.min(daysInYear(y) - 1, dayIdx(today) - start);
  return { min: 0, max, value: Math.min(max, dayIdx(date) - start), toDate: (i: number) => isoDay(start + i) };
}

export function Timeline() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const date = useStore((s) => s.date);
  const g = useStore((s) => s.granularity);
  const playing = useStore((s) => s.playing);
  const set = useStore((s) => s.set);
  const hot = useData((s) => s.hotspots);
  const loading = useData((s) => s.hotspotsLoading);
  const mdl = model(g, date);

  const label = g === 'day' ? fmtDay(date, lang) : g === 'month' ? fmtMonth(date, lang) : date.slice(0, 4);
  const go = (i: number) => set({ date: mdl.toDate(Math.max(mdl.min, Math.min(mdl.max, i))) });

  useEffect(() => {
    if (!playing) return;
    const h = window.setInterval(
      () => {
        const s = useStore.getState();
        if (useData.getState().hotspotsLoading) return; // wait for the frame being shown
        const cur = model(s.granularity, s.date);
        if (cur.value >= cur.max) s.set({ playing: false });
        else s.set({ date: cur.toDate(cur.value + 1) });
      },
      g === 'day' ? 420 : g === 'month' ? 850 : 1500,
    );
    return () => clearInterval(h);
  }, [playing, g]);

  const years = Array.from({ length: +todayIso().slice(0, 4) - Y0 + 1 }, (_, i) => Y0 + i);

  return (
    <div className="panel pointer-events-auto w-full max-w-3xl p-3" role="group" aria-label={t('time.title')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" className="btn btn-icon btn-primary" onClick={() => set({ playing: !playing })} aria-label={playing ? t('time.pause') : t('time.play')}>
          <span aria-hidden className="w-4 text-center">{playing ? '❚❚' : '▶'}</span>
        </button>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-icon" onClick={() => go(mdl.value - 1)} disabled={mdl.value <= mdl.min} aria-label={t('time.prev')}>
            <span aria-hidden>‹</span>
          </button>
          <output className="data min-w-[7.5rem] text-center text-sm text-ink" aria-live="off">
            {label}
          </output>
          <button type="button" className="btn btn-icon" onClick={() => go(mdl.value + 1)} disabled={mdl.value >= mdl.max} aria-label={t('time.next')}>
            <span aria-hidden>›</span>
          </button>
        </div>
        <Segmented
          size="sm"
          label={t('time.step')}
          value={g}
          onChange={(v) => {
            const d = v === 'day' ? date : v === 'month' ? `${date.slice(0, 7)}-01` : `${date.slice(0, 4)}-01-01`;
            set({ granularity: v, date: d, playing: false });
          }}
          options={[
            { value: 'day', label: t('time.day') },
            { value: 'month', label: t('time.month') },
            { value: 'year', label: t('time.year') },
          ]}
        />
        {g === 'day' && (
          <select
            className="input min-h-8 !w-auto !py-1 font-mono text-xs"
            aria-label={t('time.year')}
            value={date.slice(0, 4)}
            onChange={(e) => {
              const d = `${e.target.value}${date.slice(4)}`;
              set({ date: d > todayIso() ? todayIso() : d });
            }}
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        )}
        <span className="ml-auto flex items-center gap-3 text-xs text-ink-dim">
          {loading && <Spinner label={t('time.loading')} />}
          {hot && (
            <span className="data flex items-center gap-2">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: HOTSPOT_COLOR }} /> {fmtInt(hot.count, lang)} {t('time.hotspots')}
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        className="mt-2 w-full accent-accent"
        min={mdl.min}
        max={mdl.max}
        step={1}
        value={mdl.value}
        aria-label={t('time.position')}
        aria-valuetext={label}
        onChange={(e) => go(+e.target.value)}
      />
      <div className="data flex justify-between text-xs text-ink-mute" aria-hidden>
        <span>{g === 'day' ? fmtDay(mdl.toDate(mdl.min), lang) : mdl.toDate(mdl.min).slice(0, 4)}</span>
        <span>{t('time.shown')}</span>
        <span>{g === 'day' ? fmtDay(mdl.toDate(mdl.max), lang) : mdl.toDate(mdl.max).slice(0, 4)}</span>
      </div>
    </div>
  );
}
