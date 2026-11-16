// make.fun's public API: GET only, no sign-in, CORS open to any origin
// (https://make.fun/api/openapi.json describes it, https://make.fun/llms.txt the site).
//
// Three caches stand behind every read, so a view asks for data once and a second look at
// the same view costs no request at all:
//   1. memory      — the answer of this page load, reused inside a fresh window;
//   2. storage     — the answer survives a reload, so a revisit paints from disk;
//   3. revalidation— make.fun's ETag is bound to the minute: inside the same minute an
//                    If-None-Match answers 304 with no body, so a refresh can cost 0 bytes.
// Requests for the same path share one fetch, a slow request is given up on rather than
// left pending, and an answer that fails falls back to the last one that worked.

import { API, avatarUrl } from './util.js';

const STORAGE_KEY = 'makefun-frontend-cache-v2';
const FRESH_MS = 3 * 60e3; // inside this, no request at all
const STALE_MS = 12 * 60 * 60e3; // after this, an offline answer is not shown
const TIMEOUT_MS = 15e3;
const STORE_BUDGET = 1_600_000; // characters persisted across reloads

const memory = new Map(); // path -> { at, etag, etagMinute, body }
const inFlight = new Map(); // path -> Promise
const listeners = new Set(); // called whenever a fresh answer lands

/** What this session has asked of make.fun, shown in the footer. */
export const net = { requests: 0, bytes: 0, saved: 0, notModified: 0, errors: 0 };

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    const now = Date.now();
    for (const [path, record] of Object.entries(saved.records ?? {})) {
      if (record && now - record.at < STALE_MS) memory.set(path, record);
    }
  } catch {
    // A cache that cannot be read is no cache: the next read asks make.fun.
  }
}

function scheduleStore() {
  if (scheduleStore.timer) return;
  scheduleStore.timer = setTimeout(() => {
    scheduleStore.timer = 0;
    try {
      const entries = [...memory.entries()]
        .filter(([, record]) => Date.now() - record.at < STALE_MS)
        .sort((a, b) => b[1].at - a[1].at);
      const records = {};
      let size = 0;
      for (const [path, record] of entries) {
        const length = (record.raw ?? '').length;
        if (size + length > STORE_BUDGET) continue;
        size += length;
        records[path] = record;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ records }));
    } catch {
      // Out of quota, or storage denied: the memory cache still serves this page load.
    }
  }, 400);
}

readStore();

/** Ages every answer when the browser comes back to the network, so a tab left open overnight
 *  asks make.fun again on its next read instead of trusting what it kept. */
if (typeof addEventListener === 'function') {
  addEventListener('online', () => {
    const now = Date.now();
    for (const record of memory.values()) record.at = Math.min(record.at, now - FRESH_MS - 1);
    announce('*');
  });
}

/** Views subscribe to know a background refresh has landed. */
export function onChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(path) {
  for (const listener of listeners) listener(path);
}

function describeError(error, path) {
  if (error?.name === 'AbortError') return error;
  const status = error?.status ? `make.fun answered ${error.status}` : 'make.fun could not be reached';
  const failure = new Error(`${status} for ${path}`);
  failure.status = error?.status;
  failure.cause = error;
  return failure;
}

async function fetchPath(path, record, signal) {
  const minute = Math.floor(Date.now() / 60e3);
  const headers = { accept: 'application/json' };
  // The ETag is bound to the minute, so it is worth sending only within the minute it came from.
  if (record?.etag && record.etagMinute === minute) headers['if-none-match'] = record.etag;

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  const relay = () => control.abort();
  signal?.addEventListener('abort', relay, { once: true });

  try {
    net.requests += 1;
    const response = await fetch(API + path, { headers, signal: control.signal, mode: 'cors', credentials: 'omit' });
    if (response.status === 304 && record) {
      net.notModified += 1;
      record.at = Date.now();
      scheduleStore();
      return record.body;
    }
    if (!response.ok) {
      const failure = new Error('bad status');
      failure.status = response.status;
      throw failure;
    }
    const raw = await response.text();
    net.bytes += raw.length;
    const body = JSON.parse(raw);
    memory.set(path, { at: Date.now(), etag: response.headers.get('etag'), etagMinute: minute, raw, body });
    scheduleStore();
    announce(path);
    return body;
  } catch (error) {
    if (signal?.aborted) throw error;
    const last = memory.get(path);
    if (last && Date.now() - last.at < STALE_MS && error?.name !== 'AbortError') {
      net.saved += 1;
      return last.body;
    }
    net.errors += 1;
    throw describeError(error, path);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

/**
 * Reads a path of make.fun's API. Answers from memory while they are fresh, shares one
 * request between callers, revalidates with the ETag, and falls back to the last answer.
 */
export function get(path, { signal, force = false } = {}) {
  const record = memory.get(path);
  if (record && !force && Date.now() - record.at < FRESH_MS) {
    net.saved += 1;
    return Promise.resolve(record.body);
  }
  const running = inFlight.get(path);
  if (running) return running;
  const promise = fetchPath(path, record, signal).finally(() => inFlight.delete(path));
  inFlight.set(path, promise);
  return promise;
}

/** Warms a path before a reader asks for it (a card hovered, a route about to open). */
export function prefetch(path) {
  const record = memory.get(path);
  if (record && Date.now() - record.at < FRESH_MS) return;
  get(path).catch(() => {
    // A prefetch that fails is a prefetch, not an error a reader sees.
  });
}

/** The avatar of a handle, resolved against make.fun, or '' when the account has none. */
export function handleAvatar(handle, image) {
  return avatarUrl(image);
}
