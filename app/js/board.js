// The board: every live make.fun bounty with its live pot, its entry fee, its deadline and
// its entries, with a search box, category chips, a status filter and five sorts — all of
// them answered from one API answer, all of them carried in the URL so a filtered board can
// be linked or reloaded.
//
// The board as it opens asks make.fun one request (`status=open`, activity cut to times).
// Bounties that are past their deadline or already resolved are a second request, asked for
// only when a reader chooses that filter, and the list itself renders a page at a time, so a
// board of hundreds of bounties stays a small DOM.

import { get, prefetch } from './api.js';
import {
  bountyUrl, leaderboardUrl, boardUrl, topUrl,
  closesWithin, count, dateOnly, debounce, entryFee, esc, hashQuery, lastEntryAgo,
  money, numberOr, plural, pot, setHashQuery, snippet, takesEntries, timeLeft, whenVisible,
} from './util.js';

const PATH_LIVE = '/competitions?status=open&activity=times';
const PATH_EVERY = '/competitions?activity=times';
const PAGE_SIZE = 48;
const DAY = 24 * 60 * 60 * 1000;

const SORTS = {
  pot: { label: 'Biggest pot', compare: (a, b) => numberOr(b.potUsd, 0) - numberOr(a.potUsd, 0) },
  soon: { label: 'Closing soonest', compare: (a, b) => new Date(a.deadline) - new Date(b.deadline) },
  entries: { label: 'Most entries', compare: (a, b) => numberOr(b.submissionCount, 0) - numberOr(a.submissionCount, 0) },
  newest: { label: 'Newest', compare: (a, b) => new Date(b.publishedAt ?? 0) - new Date(a.publishedAt ?? 0) },
  fees: { label: 'Most entry fees paid in', compare: (a, b) => numberOr(b.entryFeesUsd, 0) - numberOr(a.entryFeesUsd, 0) },
};

const STATES = {
  live: 'Taking entries',
  judging: 'Past deadline',
  all: 'Everything',
};

/** Everything a board keystroke changes: the filters, the sort and how much is on screen. */
function initialState(query) {
  const sort = query.get('sort');
  const state = query.get('state');
  return {
    q: query.get('q') ?? '',
    cat: query.get('cat') ?? '',
    state: STATES[state] ? state : 'live',
    sort: SORTS[sort] ? sort : 'pot',
    page: 1,
    items: [],
    every: false, // whether the fuller listing has been asked for
    loading: true,
  };
}

const isJudging = (bounty) => !takesEntries(bounty) && bounty.status !== 'resolved';

function matchesState(bounty, state) {
  if (state === 'live') return takesEntries(bounty);
  if (state === 'judging') return isJudging(bounty);
  return true;
}

function matchesText(bounty, needle) {
  if (!needle) return true;
  const haystack = [
    bounty.title,
    bounty.sponsor?.name,
    bounty.category,
    (bounty.skills ?? []).join(' '),
    bounty.summary,
  ].join(' ').toLowerCase();
  return needle
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

/** The bounties the reader asked for, in the order they asked for them. */
function selection(state) {
  const needle = state.q.trim().toLowerCase();
  return state.items
    .filter((bounty) => matchesState(bounty, state.state) && matchesText(bounty, needle) && (!state.cat || bounty.category === state.cat))
    .sort(SORTS[state.sort].compare);
}

function categories(items) {
  const counts = new Map();
  for (const bounty of items) {
    if (!bounty.category) continue;
    counts.set(bounty.category, (counts.get(bounty.category) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function strip(list) {
  const live = list.filter((bounty) => takesEntries(bounty));
  const totalPot = live.reduce((sum, bounty) => sum + numberOr(bounty.potUsd, 0), 0);
  const soon = live.filter((bounty) => closesWithin(bounty, DAY)).length;
  const entries = list.reduce((sum, bounty) => sum + numberOr(bounty.submissionCount, 0), 0);
  const cell = (value, label, title = '') =>
    `<div class="cell"${title ? ` title="${esc(title)}"` : ''}><b>${value}</b><span>${label}</span></div>`;
  return `<div class="strip">
    ${cell(count(live.length), 'taking entries', 'Deadline still ahead, whatever the status says')}
    ${cell(money(totalPot), 'live pot', 'Rewards plus every entry fee paid in so far')}
    ${cell(count(soon), 'close within 24h', 'Deadline within the next day')}
    ${cell(count(entries), 'entries', 'Entries made to these bounties')}
  </div>`;
}

function controls(state, cats) {
  const sortOptions = Object.entries(SORTS)
    .map(([key, sort]) => `<option value="${key}"${state.sort === key ? ' selected' : ''}>${sort.label}</option>`)
    .join('');
  const stateOptions = Object.entries(STATES)
    .map(([key, label]) => `<option value="${key}"${state.state === key ? ' selected' : ''}>${label}</option>`)
    .join('');
  const chips = cats
    .map(
      ([name, n]) =>
        `<button class="chip" type="button" data-cat="${esc(name)}" aria-pressed="${state.cat === name}">${esc(name)} <span class="muted">${n}</span></button>`,
    )
    .join('');
  return `
    <div class="controls">
      <label class="sr" for="sort">Sort</label>
      <select id="sort">${sortOptions}</select>
      <label class="sr" for="state">Status</label>
      <select id="state">${stateOptions}</select>
      <div class="chips">
        <button class="chip" type="button" data-cat="" aria-pressed="${!state.cat}">All categories</button>
        ${chips}
      </div>
      <button class="ghost" type="button" id="clear" hidden>Clear filters</button>
      <a class="ghost button" href="${topUrl()}">Top accounts →</a>
    </div>`;
}

function card(bounty, now) {
  const fee = entryFee(bounty);
  const live = takesEntries(bounty, now);
  const soon = closesWithin(bounty, DAY, now);
  const last = lastEntryAgo(bounty, now);
  const skills = (bounty.skills ?? []).slice(0, 4).map((s) => `<span class="pill">${esc(s)}</span>`).join('');
  const badges = [
    bounty.category ? `<span class="pill">${esc(bounty.category)}</span>` : '',
    live && soon ? '<span class="pill soon">closing soon</span>' : '',
    live ? '' : '<span class="pill judging">deadline passed</span>',
    bounty.houseOnly ? '<span class="pill">house only</span>' : '',
  ].join('');
  return `
    <li class="card">
      <div class="card-top">
        <a class="card-title" href="${bountyUrl(bounty.slug)}">${esc(bounty.title)}</a>
        <span class="card-badges">${badges}</span>
      </div>
      <div class="card-sub">${esc(bounty.sponsor?.name ?? 'make.fun')}${bounty.sponsor?.isVerified ? ' ✓' : ''} · opened ${dateOnly(bounty.publishedAt)}</div>
      <p class="card-sum">${esc(snippet(bounty.summary || bounty.description, 150))}</p>
      <div class="card-stats">
        <span class="pot"><b>${pot(bounty)}</b> pot</span>
        ${fee ? `<span><b>${fee}</b> entry fee</span>` : '<span class="muted">no entry fee</span>'}
        <span data-left="${esc(bounty.deadline)}"><b>${timeLeft(bounty.deadline, now)}</b></span>
        <span><b>${count(bounty.submissionCount)}</b> ${numberOr(bounty.submissionCount, 0) === 1 ? 'entry' : 'entries'}</span>
      </div>
      <div class="card-foot">
        <span>${live ? 'deadline ' : 'closed '}${dateOnly(bounty.deadline)}</span>
        ${last ? `<span>last entry ${last}</span>` : ''}
        ${numberOr(bounty.entryFeePayers, 0) ? `<span>${plural(bounty.entryFeePayers, 'payer', 'payers')}</span>` : ''}
        <span class="card-badges">${skills}</span>
      </div>
      <div class="card-foot">
        <a href="${leaderboardUrl(bounty.slug)}">Leaderboard</a>
        <a href="${esc(bounty.url ? bounty.url : bountyUrl(bounty.slug))}" rel="noopener">On make.fun ↗</a>
      </div>
    </li>`;
}

function listMarkup(list, state) {
  if (state.loading) return '<div class="skeleton"></div><div class="skeleton"></div>';
  if (list.length === 0) {
    return `<div class="empty"><p>No bounty matches ${state.q ? `“${esc(state.q)}”` : 'these filters'}.</p>
      <p class="muted">Try another word, another category, or <button class="ghost" type="button" id="clear-2">clear the filters</button>.</p></div>`;
  }
  const now = Date.now();
  const shown = list.slice(0, state.page * PAGE_SIZE);
  const cards = shown.map((bounty) => card(bounty, now)).join('');
  const more =
    shown.length < list.length
      ? `<div class="more" id="more"><button class="primary" type="button">Show ${Math.min(PAGE_SIZE, list.length - shown.length)} more (${count(list.length - shown.length)} left)</button></div>`
      : '';
  return `<ol class="cards">${cards}</ol>${more}`;
}

export async function view(ctx) {
  const state = initialState(ctx.query);
  const { mount } = ctx;
  const { input } = ctx.search;
  const el = {};

  mount.innerHTML = `
    <h1>Live bounties on make.fun</h1>
    <p class="muted">Every bounty taking entries, with the pot as it stands, the entry fee, the deadline and the entries.
    Open one for its rules, or its leaderboard.</p>
    <div id="strip"></div>
    <div id="controls"></div>
    <p class="result-line" id="result"></p>
    <div id="list"></div>`;

  const stripBox = mount.querySelector('#strip');
  const controlsBox = mount.querySelector('#controls');
  const listBox = mount.querySelector('#list');
  const resultLine = mount.querySelector('#result');
  input.value = state.q;

  const syncUrl = () => {
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.cat) params.set('cat', state.cat);
    if (state.state !== 'live') params.set('state', state.state);
    if (state.sort !== 'pot') params.set('sort', state.sort);
    setHashQuery(boardUrl(), params);
  };

  /** The selects survive a filter change, so their references are taken after every paint. */
  function paintControls(cats) {
    controlsBox.innerHTML = controls(state, cats);
    el.sort = controlsBox.querySelector('#sort');
    el.state = controlsBox.querySelector('#state');
    el.clear = controlsBox.querySelector('#clear');
    el.sort.addEventListener('change', () => {
      state.sort = el.sort.value;
      syncUrl();
      paint(true);
    });
    el.state.addEventListener('change', () => {
      state.state = el.state.value;
      ensureEvery();
      syncUrl();
      paint(true);
    });
  }

  function paint(resetPage = false) {
    if (resetPage) state.page = 1;
    const list = selection(state);
    listBox.innerHTML = listMarkup(list, state);
    resultLine.textContent =
      `${plural(list.length, 'bounty', 'bounties')}` +
      (state.q ? ` matching “${state.q}”` : '') +
      (state.cat ? ` in ${state.cat}` : '') +
      ` · sorted by ${SORTS[state.sort].label.toLowerCase()} · showing ${Math.min(list.length, state.page * PAGE_SIZE)}`;
    el.clear.hidden = !(state.q || state.cat || state.state !== 'live' || state.sort !== 'pot');
    el.sort.value = state.sort;
    el.state.value = state.state;
    for (const chip of controlsBox.querySelectorAll('.chip[data-cat]')) {
      chip.setAttribute('aria-pressed', String(chip.dataset.cat === state.cat));
    }
    wireMore();
  }

  /** The next page arrives when the button is pressed or when it comes into view. */
  function wireMore() {
    const more = listBox.querySelector('#more');
    if (!more) return;
    const extend = () => {
      state.page += 1;
      paint();
    };
    more.querySelector('button').addEventListener('click', extend);
    whenVisible(more, extend, '400px');
  }

  const onFilter = debounce(() => {
    state.q = input.value.trim();
    syncUrl();
    paint(true);
  }, 70);

  input.addEventListener('input', onFilter);
  ctx.onCleanup(() => input.removeEventListener('input', onFilter));

  /** Enter opens the first bounty on screen: a search box that can be used without the mouse. */
  const openFirst = (event) => {
    if (event.key !== 'Enter') return;
    const first = listBox.querySelector('a.card-title');
    if (!first) return;
    event.preventDefault();
    first.click();
  };
  input.addEventListener('keydown', openFirst);
  ctx.onCleanup(() => input.removeEventListener('keydown', openFirst));

  mount.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip[data-cat]');
    if (chip) {
      state.cat = chip.dataset.cat;
      syncUrl();
      paint(true);
      return;
    }
    if (event.target.closest('#clear') || event.target.closest('#clear-2')) {
      input.value = '';
      Object.assign(state, { q: '', cat: '', state: 'live', sort: 'pot' });
      syncUrl();
      paint(true);
    }
  });

  /** Hovering a card warms its bounty page, so the click is instant. */
  mount.addEventListener('pointerover', (event) => {
    const link = event.target.closest('a.card-title, a[href^="#/bounty/"]');
    if (!link) return;
    const slug = link.getAttribute('href').replace('#/bounty/', '').split('/')[0];
    if (slug) prefetch('/competitions/' + slug + '?submissions=summary');
  }, { passive: true });

  /** The second request, only when a reader looks past the bounties taking entries. */
  let fetching = null;
  function ensureEvery() {
    if (state.every || state.state !== 'all' || fetching) return;
    fetching = get(PATH_EVERY)
      .then((answer) => {
        state.every = true;
        state.items = answer.items ?? [];
        paint(true);
      })
      .catch(() => {
        fetching = null;
      });
  }

  // The clock: deadlines are the one thing on this page that moves by itself. When one passes
  // while the board is open the bounty stops taking entries, so the board re-filters itself
  // then — the reader sees the board as it is, not as it was when the page loaded.
  let liveCount = 0;
  const countLive = (items, now) => items.filter((bounty) => takesEntries(bounty, now)).length;
  const clock = setInterval(() => {
    const now = Date.now();
    for (const node of listBox.querySelectorAll('[data-left]')) {
      const value = timeLeft(node.dataset.left, now);
      const bold = node.querySelector('b');
      if (bold && bold.textContent !== value) bold.textContent = value;
    }
    const live = countLive(state.items, now);
    if (state.state !== 'all' && live !== liveCount) {
      liveCount = live;
      stripBox.innerHTML = strip(state.items);
      paintControls(categories(state.items.filter((bounty) => takesEntries(bounty, now))));
      paint(true);
    }
  }, 1000);
  ctx.onCleanup(() => clearInterval(clock));
  ctx.setTitle('');

  const answer = await get(PATH_LIVE, { signal: ctx.signal });
  state.items = answer.items ?? [];
  state.loading = false;
  liveCount = countLive(state.items, Date.now());
  stripBox.innerHTML = strip(state.items);
  paintControls(categories(state.items.filter((bounty) => takesEntries(bounty))));
  paint(true);
}
