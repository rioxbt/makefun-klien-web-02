// A bounty's leaderboard: the phase's standings as make.fun ranks them, with the rank key's
// interval, each entry's size and its handle, which opens that account's profile.
//
// make.fun answers a big board in two shapes and this view reads both: ?rows=first is the
// small read — the first ten rows whole and every row past them thin, which is everything a
// page drawing its first rows needs — and ?rows=all is every row whole, which can run to
// megabytes on a board with thousands of entries. So the view paints at once from the small
// read, reads the whole board beside it when the field is modest, and offers the whole board
// as a button when it is not. Whichever read it has, only sixty rows are built as markup at a
// time; the rest arrive as the reader scrolls.

import { get } from './api.js';
import {
  ago, bountyUrl, columnValue, count, dateTime, esc, profileUrl, urlFor, whenVisible,
} from './util.js';

const ROWS_PAGE = 60;
const WHOLE_BOARD_LIMIT = 600; // boards this size or smaller are read whole without being asked
const PHASES = { dev: 'Development', final: 'Final' };

const leaderboardPath = (slug, phase, view, rows) =>
  '/competitions/' + encodeURIComponent(slug) + '/leaderboard?rows=' + rows +
  (phase ? '&phase=' + encodeURIComponent(phase) : '') +
  (view ? '&view=' + encodeURIComponent(view) : '');

/** The columns make.fun shows for this harness, its tie-break column last when it is apart. */
function columnsOf(data) {
  const columns = (data.columns ?? []).filter((column) => !column.hidden);
  const tie = data.tie_break;
  if (tie && !columns.some((column) => column.key === tie.key)) {
    columns.push({ key: tie.key, title: tie.title, precision: 0, source: tie.key === 'bytes' ? 'bytes' : null });
  }
  return columns;
}

/** A thin row of a ?rows=first answer as a whole row: it carries the rank key alone. */
function widen(thin, rankKey) {
  return {
    ...thin,
    values: { [rankKey]: thin.value },
    display: { [rankKey]: thin.display ?? String(thin.value ?? '') },
    thin: true,
  };
}

const rowsOf = (data, rankKey) => [
  ...(data.entries ?? []),
  ...((data.rest ?? []).map((thin) => widen(thin, rankKey))),
];

/** The half-width of the rank key's interval, in the unit the rank key is shown in. */
function intervalText(entry, column) {
  if (!entry.interval) return '';
  const low = Number(entry.interval.low);
  const high = Number(entry.interval.high);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return '';
  const micro = typeof column?.source === 'string' && column.source.endsWith('_micro');
  const half = (high - low) / 2;
  return micro ? '±' + (half / 1e6).toFixed(6) : '±' + count(Math.round(half));
}

function row(entry, columns, index) {
  const avatar = entry.image ?? entry.avatar?.url_small ?? null;
  const top = entry.rank !== null && entry.rank <= 3 ? ' top' : '';
  const interval = intervalText(entry, columns[0]);
  const badges = `${entry.house ? ' <span class="badge">house</span>' : ''}${entry.internal ? ' <span class="badge">internal</span>' : ''}${entry.baseline ? ' <span class="badge">baseline</span>' : ''}`;
  return `
    <tr data-index="${index}">
      <td class="rank${top}">${entry.rank ?? '—'}</td>
      <td>
        <span class="handle">
          ${avatar ? `<img class="avatar" src="${esc(avatar.startsWith('http') ? avatar : 'https://make.fun' + avatar)}" alt="" width="24" height="24" loading="lazy" decoding="async" crossorigin="anonymous">` : '<span class="avatar" aria-hidden="true"></span>'}
          <a class="who" href="${profileUrl(entry.handle)}">@${esc(entry.handle)}</a>
        </span>
      </td>
      <td>${esc(entry.title ?? '')}${badges}</td>
      ${columns
        .map(
          (column) =>
            `<td class="num">${esc(columnValue(column, entry))}${column === columns[0] && interval ? ` <span class="sub">${interval}</span>` : ''}</td>`,
        )
        .join('')}
      <td class="sub nowrap">${entry.received_at ? ago(entry.received_at) : ''}</td>
    </tr>`;
}

export async function view(ctx) {
  const slug = ctx.route.params.slug;
  const { mount } = ctx;
  const phase = ctx.query.get('phase') ?? '';
  const view = ctx.query.get('view') ?? '';
  const small = await get(leaderboardPath(slug, phase, view, 'first'), { signal: ctx.signal });

  const title = small.competition?.title ?? slug;
  const rankKey = small.rank_key ?? 'judge';
  const columns = columnsOf(small);
  const restCount = (small.rest ?? []).length;
  let all = rowsOf(small, rankKey).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  let whole = restCount === 0; // whether every row is a whole row
  ctx.setTitle(`${title} — leaderboard`);

  const phaseKey = small.phase?.key ?? phase ?? 'dev';
  const viewKey = small.view ?? small.views?.[0] ?? 'overall';
  const tabs = Object.entries(PHASES)
    .map(
      ([key, label]) =>
        `<a class="button"${key === phaseKey ? ' aria-current="page"' : ''} href="${urlFor('leaderboard', { slug }, '?phase=' + key + (viewKey ? '&view=' + viewKey : ''))}">${label}</a>`,
    )
    .join('');
  const viewTabs = (small.views ?? [])
    .map(
      (key) =>
        `<a class="button"${key === viewKey ? ' aria-current="page"' : ''} href="${urlFor('leaderboard', { slug }, '?phase=' + phaseKey + '&view=' + key)}">${esc(key)}</a>`,
    )
    .join('');

  mount.innerHTML = `
    <p class="crumb"><a href="#/">← All live bounties</a> · <a href="${bountyUrl(slug)}">${esc(title)}</a></p>
    <h1>Leaderboard — ${esc(title)}</h1>
    <p class="muted">
      ${esc(small.phase?.title ?? 'Phase')}${small.phase?.ends_at ? `, to ${dateTime(small.phase.ends_at)}` : ''}
      · ranked by ${esc(columns[0]?.title ?? rankKey)} (${esc(small.harness_kind ?? 'unknown harness')})
      · ${count(all.length)} ranked ${all.length === 1 ? 'entry' : 'entries'}
      ${small.metrics_withheld ? '· build costs and models are withheld from public view' : ''}
    </p>
    <div class="tabs">${tabs}${viewTabs ? `<span class="muted" style="align-self:center">·</span>${viewTabs}` : ''}</div>
    <div class="controls">
      <label class="sr" for="filter">Filter entries</label>
      <input id="filter" type="search" placeholder="Filter by handle or title…" autocomplete="off" spellcheck="false" style="max-width:22rem">
      <span class="muted" id="shown"></span>
      <span id="whole"></span>
    </div>
    <div class="table-wrap">
      <table class="rows">
        <thead>
          <tr>
            <th>#</th><th>Account</th><th>Entry</th>
            ${columns.map((column) => `<th class="num">${esc(column.title)}</th>`).join('')}
            <th>Received</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="more" id="more"></div>
    <p class="muted" id="note"></p>
    ${small.resolution ? `<p class="muted">${esc(small.resolution.summary ?? '')}${small.resolution.tieBreak ? ` Tie-break: ${esc(small.resolution.tieBreak)}` : ''}</p>` : ''}`;

  const body = mount.querySelector('#rows');
  const moreBox = mount.querySelector('#more');
  const shownLabel = mount.querySelector('#shown');
  const wholeBox = mount.querySelector('#whole');
  const note = mount.querySelector('#note');
  const filterInput = mount.querySelector('#filter');

  let rows = all;
  let page = 1;

  function paint(reset) {
    if (reset) page = 1;
    const slice = rows.slice(0, page * ROWS_PAGE);
    body.innerHTML = slice.map((entry, index) => row(entry, columns, index)).join('');
    shownLabel.textContent = `${count(slice.length)} of ${count(rows.length)} shown`;
    moreBox.innerHTML =
      slice.length < rows.length
        ? `<button class="primary" type="button">Show ${Math.min(ROWS_PAGE, rows.length - slice.length)} more</button>`
        : rows.length === 0
          ? '<span class="muted">Nothing matches that filter.</span>'
          : '<span class="muted">End of the board.</span>';
    const button = moreBox.querySelector('button');
    if (button) {
      const extend = () => {
        page += 1;
        paint(false);
      };
      button.addEventListener('click', extend);
      whenVisible(moreBox, extend, '500px');
    }
  }

  filterInput.addEventListener('input', () => {
    const needle = filterInput.value.trim().toLowerCase();
    rows = needle ? all.filter((entry) => `${entry.handle ?? ''} ${entry.title ?? ''}`.toLowerCase().includes(needle)) : all;
    paint(true);
  });

  paint(true);

  if (whole) return;
  note.textContent =
    `make.fun answered the first ten rows whole and the other ${count(restCount)} with the rank key alone; ` +
    'the columns of those rows read “—” until the whole board is read.';

  /** The whole board, every row with every column: read beside the small one, or on request. */
  async function readWholeBoard() {
    wholeBox.innerHTML = '<span class="muted">Reading the whole board…</span>';
    try {
      const full = await get(leaderboardPath(slug, phase, view, 'all'), { signal: ctx.signal });
      all = (full.entries ?? []).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
      whole = true;
      note.textContent = '';
      wholeBox.innerHTML = `<span class="muted">whole board read: ${count(all.length)} rows, every column</span>`;
      filterInput.dispatchEvent(new Event('input'));
    } catch (error) {
      wholeBox.innerHTML = `<span class="muted">The whole board did not load (${esc(error.message)}).</span>`;
    }
  }

  if (restCount <= WHOLE_BOARD_LIMIT) {
    await readWholeBoard();
  } else {
    wholeBox.innerHTML = `<button type="button">Read the whole board (${count(restCount)} more rows, in full)</button>`;
    wholeBox.querySelector('button').addEventListener('click', readWholeBoard);
  }
}
