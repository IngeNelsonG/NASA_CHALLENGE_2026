export const USE_MOCKS = String(import.meta.env.VITE_USE_MOCKS ?? 'false') === 'true';
export const API_URL = String(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** Working title — change it here and in index.html. */
export const APP_NAME = 'Ember';
export const RECORD_START = '2000-01-01';
