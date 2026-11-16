// Formatting and DOM-free helpers shared by every view.
// make.fun shows its numbers in UTC and its money in whole cents, so these do too.

/** The site the API lives on; every request and every avatar is resolved against it. */
export const SITE = 'https://make.fun';
export const API = SITE + '/api';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text from the API goes into HTML only through here. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => (n < 10 ? '0' + n : '' + n);

/** "16 Nov 2026, 17:53 UTC" — fixed to UTC so a reader and the API agree. */
export function dateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** "16 Nov 2026" */
export function dateOnly(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Cents are dropped when they are zero: $500, $699.50, $0.50. */
export function money(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n)) return '—';
  const cents = Math.round(n * 100) % 100;
  const whole = Math.floor(Math.abs(n)).toLocaleString('en-US');
  return (n < 0 ? '-$' : '$') + whole + (cents ? '.' + pad(cents) : '');
}

export function count(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('en-US') : '0';
}

export function plural(n, one, many) {
  return count(n) + ' ' + (Number(n) === 1 ? one : many);
}

/** 703173 -> "687 KiB" */
export function bytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1024) return v + ' B';
  if (v < 1024 * 1024) return (v / 1024).toFixed(v < 10240 ? 1 : 0) + ' KiB';
  return (v / 1048576).toFixed(1) + ' MiB';
}

/** The judge's win rate is an integer of millionths: 950587 -> "0.950587". */
export function rate(micro) {
  const v = Number(micro);
  if (!Number.isFinite(v)) return '—';
  return (v / 1e6).toFixed(6);
}

const MINUTE = 60e3;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "2d 18h left", "38m left", "closed 6d ago" — read off the deadline, never the status. */
export function timeLeft(iso, now = Date.now()) {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return 'no deadline';
  const ms = at - now;
  if (ms <= 0) return 'closed ' + span(-ms) + ' ago';
  return span(ms) + ' left';
}

/** "12m ago", "3d 4h ago" — for something that has already happened. */
export function ago(iso, now = Date.now()) {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return '';
  const ms = Math.max(1000, now - at);
  return span(ms) + ' ago';
}

function span(ms) {
  if (ms < MINUTE) return Math.max(1, Math.round(ms / 1000)) + 's';
  if (ms < HOUR) return Math.round(ms / MINUTE) + 'm';
  if (ms < DAY) return Math.floor(ms / HOUR) + 'h ' + Math.round((ms % HOUR) / MINUTE) + 'm';
  return Math.floor(ms / DAY) + 'd ' + Math.round((ms % DAY) / HOUR) + 'h';
}

/**
 * A bounty takes entries while its deadline is in the future, whatever its status says:
 * a bounty past its deadline may still read "open" until its results are published.
 */
export function takesEntries(bounty, now = Date.now()) {
  if (bounty.acceptingSubmissions === false) return false;
  const at = new Date(bounty.deadline).getTime();
  return !Number.isNaN(at) && at > now;
}

export function closesWithin(bounty, ms, now = Date.now()) {
  const at = new Date(bounty.deadline).getTime();
  if (Number.isNaN(at)) return false;
  return at > now && at - now <= ms;
}

/** The money on the table now: the reward plus every entry fee paid into it. */
export function pot(bounty) {
  const value = bounty.potUsd ?? bounty.rewardAmount;
  return money(value);
}

export function entryFee(bounty) {
  const fee = Number(bounty.entryFeeUsd);
  return fee > 0 ? money(fee) : null;
}

/** The first sentence or so of a markdown description, for a card. */
export function snippet(markdown, max = 150) {
  const text = String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>#|-]+/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}

/** The newest entry an activity=times listing carries, as "12m ago", or ''. */
export function lastEntryAgo(bounty, now = Date.now()) {
  const rows = bounty.submissions;
  if (!Array.isArray(rows) || rows.length === 0) return '';
  let newest = 0;
  for (const row of rows) {
    const at = new Date(row?.createdAt ?? 0).getTime();
    if (at > newest) newest = at;
  }
  return newest ? ago(newest, now) : '';
}

/** An avatar path from the API ("/api/avatars/x.webp") as an absolute make.fun URL. */
export function avatarUrl(path) {
  if (!path) return '';
  return /^https?:\/\//.test(path) ? path : SITE + path;
}

/** The API's own page for a bounty, for readers who want make.fun's own view. */
export function siteUrl(path) {
  if (!path) return SITE;
  return /^https?:\/\//.test(path) ? path : SITE + path;
}

/** "0.950587" for a column the leaderboard describes. */
export function columnValue(column, entry) {
  const raw = entry?.values?.[column.key];
  if (raw === null || raw === undefined) return '—';
  if (column.key === 'bytes') return bytes(raw);
  if (typeof column.source === 'string' && column.source.endsWith('_micro')) return rate(raw);
  if (column.key === 'valid') return raw ? 'yes' : 'no';
  const shown = entry?.display?.[column.key];
  if (typeof shown === 'string' && shown !== '') return shown;
  const precision = Number(column.precision ?? 0);
  return Number.isFinite(Number(raw)) ? Number(raw).toFixed(precision) : String(raw);
}

/** A ranked value as a profile's `score` block gives it: { column, value, display }. */
export function scoreText(score) {
  const column = score?.column;
  if (!column) return '';
  const key = column.key ?? 'value';
  return columnValue(column, { values: { [key]: score.value }, display: { [key]: score.display } });
}

/** The address of one of the app's four routes and its query. */
export function urlFor(name, params = {}, query = '') {
  const path =
    name === 'bounty' ? `/bounty/${encodeURIComponent(params.slug)}`
    : name === 'leaderboard' ? `/bounty/${encodeURIComponent(params.slug)}/leaderboard`
    : name === 'profile' ? `/u/${encodeURIComponent(params.handle)}`
    : name === 'top' ? '/top'
    : '/';
  return '#' + path + query;
}

export const boardUrl = (query = '') => urlFor('board', {}, query);
export const bountyUrl = (slug) => urlFor('bounty', { slug });
export const leaderboardUrl = (slug, query = '') => urlFor('leaderboard', { slug }, query);
export const profileUrl = (handle) => urlFor('profile', { handle });
export const topUrl = (query = '') => urlFor('top', {}, query);

/** The query of a hash route: #/?q=chess&sort=soon -> URLSearchParams. */
export function hashQuery(hash = location.hash) {
  const at = hash.indexOf('?');
  return new URLSearchParams(at === -1 ? '' : hash.slice(at + 1));
}

/** Writes the query back into the hash without adding a history entry. */
export function setHashQuery(hash, params) {
  const at = hash.indexOf('?');
  const path = at === -1 ? hash : hash.slice(0, at);
  const query = params.toString();
  const next = query ? path + '?' + query : path;
  if (next !== hash) history.replaceState(history.state, '', next === '#/' ? '#/' : next);
  return next;
}

/** A short, debounced wrapper: search boxes filter on every keystroke, but not on every byte. */
export function debounce(fn, ms = 90) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Calls back once when the element first comes into view, or at once where that is unsupported. */
export function whenVisible(element, callback, rootMargin = '600px') {
  if (!('IntersectionObserver' in window)) {
    callback();
    return null;
  }
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      observer.disconnect();
      callback();
    }
  }, { rootMargin });
  observer.observe(element);
  return observer;
}

/** Everything a reader may click is reachable by keyboard: keeps focus on the new title. */
export function focusMain() {
  const main = document.getElementById('view');
  if (main) main.focus({ preventScroll: true });
}

export const numberOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
