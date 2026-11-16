// The shell: one router over hash routes, the header, the theme, and the lifecycle that
// every view is given. A view renders into #view and may register a teardown; the shell
// aborts its fetch and runs its teardown before the next route renders, so nothing a view
// left behind can write into another view's page.
//
//   #/                              the board of live bounties
//   #/bounty/<slug>                 one bounty: summary, description, rules, rewards, dates
//   #/bounty/<slug>/leaderboard     that bounty's leaderboard
//   #/u/<handle>                    an account's public profile
//   #/top                           the accounts that won the most (or were paid the most)
//
// window.__shotReady is false from the moment a route starts loading and true once its data
// has rendered, so a screenshot script knows when to capture.

import { prefetch, net, onChange } from './api.js';
import { focusMain, urlFor } from './util.js';
import * as boardRoute from './board.js';

const LAZY = {
  bounty: () => import('./bounty.js'),
  leaderboard: () => import('./leaderboard.js'),
  profile: () => import('./profile.js'),
  top: () => import('./top.js'),
};

const PAGE_TITLE = 'make.fun bounties';
const THEME_KEY = 'makefun-frontend-theme';

const mount = document.getElementById('view');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const netLabel = document.getElementById('net');
const footNet = document.getElementById('foot-net');

let live = null; // { controller, cleanups, renderSeq }
let renderSeq = 0;

/** "#/bounty/tiny-chess-01/leaderboard?phase=final" as [name, params]. */
export function parseRoute(hash) {
  const path = hash.replace(/^#/, '').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'board', params: {} };
  if (parts[0] === 'bounty' && parts[1] && parts[2] === 'leaderboard') return { name: 'leaderboard', params: { slug: decode(parts[1]) } };
  if (parts[0] === 'bounty' && parts[1]) return { name: 'bounty', params: { slug: decode(parts[1]) } };
  if (parts[0] === 'leaderboard' && parts[1]) return { name: 'leaderboard', params: { slug: decode(parts[1]) } };
  if (parts[0] === 'u' && parts[1]) return { name: 'profile', params: { handle: decode(parts[1]) } };
  if (parts[0] === 'top') return { name: 'top', params: {} };
  return { name: 'board', params: {} };
}

const decode = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

function themeMode() {
  return document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
}

function setTheme(mode) {
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // A reader who blocks storage still gets the theme of this page load.
  }
}

function showNetwork() {
  const text = `${net.requests} ${net.requests === 1 ? 'request' : 'requests'} · ${Math.round(net.bytes / 1024)} KB`;
  netLabel.textContent = text;
  const saved = net.saved + net.notModified;
  footNet.innerHTML =
    `Reading <a href="https://make.fun">make.fun</a>&rsquo;s public API, GET only: ` +
    `<b>${text}</b>${saved ? `, ${saved} answered from cache` : ''}.`;
}

function markNav(name) {
  for (const link of document.querySelectorAll('[data-nav]')) {
    if (link.dataset.nav === name) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

function showError(error, retry) {
  mount.innerHTML = `
    <h1>That did not load</h1>
    <div class="error">
      <p class="muted" style="margin:0">${String(error?.message ?? error)}</p>
      <button class="primary" id="retry" type="button">Try again</button>
    </div>`;
  mount.querySelector('#retry')?.addEventListener('click', retry);
}

async function render() {
  const shown = ++renderSeq;
  live?.controller.abort();
  for (const teardown of live?.cleanups ?? []) {
    try {
      teardown();
    } catch {
      // A teardown that throws never stops the next route.
    }
  }

  const controller = new AbortController();
  live = { controller, cleanups: [], renderSeq: shown };
  window.__shotReady = false;

  const hash = location.hash || '#/';
  const route = parseRoute(hash);
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  const cleanups = live.cleanups;
  const ctx = {
    mount,
    route,
    query,
    signal: controller.signal,
    onCleanup: (fn) => cleanups.push(fn),
    setTitle: (title) => {
      document.title = title ? `${title} · ${PAGE_TITLE}` : PAGE_TITLE;
    },
    search: { form: searchForm, input: searchInput },
    reload: () => render(),
  };

  searchForm.hidden = route.name !== 'board' && route.name !== 'top';
  markNav(route.name === 'top' ? 'top' : route.name === 'board' ? 'board' : '');
  if (route.name !== 'board' && route.name !== 'top') searchInput.value = query.get('q') ?? searchInput.value;

  handleSearch(route);
  window.scrollTo(0, 0);

  try {
    const view = route.name === 'board' ? boardRoute : await LAZY[route.name]();
    if (shown !== renderSeq) return;
    await view.view(ctx);
    if (shown === renderSeq) focusMain();
  } catch (error) {
    if (shown !== renderSeq || error?.name === 'AbortError') return;
    showError(error, () => render());
  } finally {
    if (shown === renderSeq) window.__shotReady = true;
  }
}

/** The header search box: a filter on the board, a jump to the board anywhere else. */
function handleSearch(route) {
  const submit = (event) => {
    event.preventDefault();
    const value = searchInput.value.trim();
    if (route.name === 'board' || route.name === 'top') return; // the view filters this page itself
    location.hash = urlFor('board', {}, value ? '?q=' + encodeURIComponent(value) : '');
  };
  searchForm.addEventListener('submit', submit);
  live?.cleanups.push(() => searchForm.removeEventListener('submit', submit));
}

document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  if (event.key === 'Escape' && document.activeElement === searchInput) {
    searchInput.value = '';
    searchInput.blur();
  }
});

/** A link a reader is about to open is warmed first: its module and its data. */
document.addEventListener('pointerover', (event) => {
  const link = event.target.closest?.('a[href^="#/"]');
  if (!link) return;
  const route = parseRoute(link.getAttribute('href'));
  if (route.name === 'bounty') prefetch('/competitions/' + encodeURIComponent(route.params.slug) + '?submissions=summary');
  if (route.name === 'leaderboard') prefetch('/competitions/' + encodeURIComponent(route.params.slug) + '/leaderboard?rows=first');
  if (route.name === 'profile') prefetch('/profiles/' + encodeURIComponent(route.params.handle));
  if (route.name !== 'board' && LAZY[route.name]) LAZY[route.name]().catch(() => {});
}, { passive: true });

document.getElementById('theme').addEventListener('click', () => {
  setTheme(themeMode() === 'dark' ? 'light' : 'dark');
});

onChange(showNetwork);

try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) setTheme(saved);
} catch {
  // No stored theme: the system's choice stands.
}

showNetwork();
addEventListener('hashchange', render);
render();