import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useT } from '@/app/i18n';
import { api } from '@/lib/api';
import type { AlertAssessment, AlertSubscriptionResponse } from '@/lib/types';
import type { Lang } from '@/store';

type Props = {
  currentAoiId: string;
  currentAoiName: string;
  countries: AlertAssessment[];
  alerts: AlertAssessment[];
  lang: Lang;
};

const CREAM_FIELD =
  'min-h-[42px] w-full rounded-lg border border-line bg-cream-deep/60 px-3 py-2 text-sm text-ink placeholder:text-ink-mute focus:border-ink focus:outline-none';

/** Direct email newsletter subscription block integrated cleanly on the cream surface. */
export function NewsletterCard({
  currentAoiId,
  currentAoiName,
  countries,
  alerts,
  lang,
}: Props) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [targetAoi, setTargetAoi] = useState(currentAoiId);
  const [minSeverity, setMinSeverity] = useState<AlertAssessment['severity']>('WATCH');
  const [sendImmediate, setSendImmediate] = useState(true);
  const [result, setResult] = useState<AlertSubscriptionResponse | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  useEffect(() => {
    setTargetAoi(currentAoiId);
  }, [currentAoiId]);

  const options = useMemo(() => {
    const map = new Map<string, string>();
    map.set(currentAoiId, currentAoiName);
    for (const r of alerts) map.set(r.aoi_id, r.region_name);
    for (const c of countries) map.set(c.aoi_id, c.region_name);
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [currentAoiId, currentAoiName, countries, alerts]);

  const mut = useMutation({
    mutationFn: () =>
      api.subscribeAlerts({
        email: email.trim(),
        name: name.trim(),
        aoi_id: targetAoi,
        min_severity: minSeverity,
        lang,
        send_immediate_report: sendImmediate,
      }),
    onSuccess: (data) => {
      setErrMsg(null);
      setResult(data);
    },
    onError: (err) => {
      setResult(null);
      setErrMsg(err instanceof Error ? err.message : t('common.error'));
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setResult(null);
    setErrMsg(null);
    mut.mutate();
  };

  return (
    <div id="alert-newsletter" className="mt-12 border-t border-line pt-10" aria-labelledby="newsletter-title">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.45fr] lg:gap-12">
        <div>
          <p className="eyebrow">{t('news.eyebrow')}</p>
          <h4 id="newsletter-title" className="mt-2 font-display text-2xl text-ink sm:text-3xl">
            {t('news.title')}
          </h4>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">{t('news.lead')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">{t('news.email_label')} *</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('news.email_ph')}
                className={CREAM_FIELD}
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">{t('news.name_label')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('news.name_ph')}
                className={CREAM_FIELD}
              />
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">{t('news.region_label')}</span>
              <select
                value={targetAoi}
                onChange={(e) => setTargetAoi(e.target.value)}
                className={`${CREAM_FIELD} bg-cream`}
              >
                {options.map((opt) => (
                  <option key={opt.id} value={opt.id} className="bg-cream text-ink">
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1.5 text-sm">
              <span className="font-medium text-ink">{t('news.level_label')}</span>
              <select
                value={minSeverity}
                onChange={(e) => setMinSeverity(e.target.value as AlertAssessment['severity'])}
                className={`${CREAM_FIELD} bg-cream`}
              >
                <option value="WATCH" className="bg-cream text-ink">
                  {t('news.level_watch')}
                </option>
                <option value="WARNING" className="bg-cream text-ink">
                  {t('news.level_warning')}
                </option>
                <option value="CRITICAL" className="bg-cream text-ink">
                  {t('news.level_critical')}
                </option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <label className="tap flex cursor-pointer items-center gap-2.5 text-sm text-ink-dim">
              <input
                type="checkbox"
                checked={sendImmediate}
                onChange={(e) => setSendImmediate(e.target.checked)}
                className="h-4 w-4 accent-coal"
              />
              <span>{t('news.immediate_label')}</span>
            </label>

            <button
              type="submit"
              disabled={mut.isPending || !email.trim()}
              className="inline-flex min-h-[42px] items-center justify-center rounded-lg bg-coal px-5 py-2 text-sm font-semibold text-cream transition-colors hover:bg-graphite-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mut.isPending ? t('news.submitting') : t('news.submit')}
            </button>
          </div>

          {result && (
            <p
              role="status"
              className={`rounded-r-lg border border-line border-l-4 bg-cream-deep/70 px-4 py-3 text-sm text-ink ${
                result.status === 'sent'
                  ? 'border-l-sev-normal'
                  : result.status === 'subscribed_smtp_pending'
                    ? 'border-l-sev-watch'
                    : 'border-l-sev-critical'
              }`}
            >
              {lang === 'es' ? result.message_es : result.message_en}
            </p>
          )}

          {errMsg && (
            <p
              role="alert"
              className="rounded-r-lg border border-line border-l-4 border-l-sev-critical bg-cream-deep/70 px-4 py-3 text-sm text-ink"
            >
              {errMsg}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
