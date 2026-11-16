// One bounty: its summary, its description, its rules, the rewards table with the live pot,
// its dates and its status, then its entries — each entry a link to that account's profile.
//
// Three things are deliberately deferred, because a bounty page is the heaviest page here
// and almost none of it is read on arrival: the rules are rendered the first time their
// <details> is opened, the description is rendered after the numbers are on screen, and the
// entries are one page of twenty, with the next twenty asked for only when asked for.

import { get } from './api.js';
import { renderMarkdown } from './md.js';
import {
  leaderboardUrl, profileUrl,
  ago, avatarUrl, count, dateTime, entryFee, esc, money, plural, pot, siteUrl,
  takesEntries, timeLeft,
} from './util.js';

const ENTRIES_PAGE = 20;

const detailPath = (slug) => '/competitions/' + encodeURIComponent(slug) + '?submissions=summary';
const entriesPath = (slug, cursor) =>
  '/competitions/' + encodeURIComponent(slug) + '/submissions?limit=' + ENTRIES_PAGE + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');

/** "Taking entries", "Entries closed, results pending" or "Resolved", read from the deadline. */
function statusOf(bounty) {
  if (takesEntries(bounty)) return { text: 'Taking entries', kind: 'live' };
  if (bounty.status === 'resolved') return { text: 'Resolved', kind: 'judging' };
  return { text: 'Entries closed, results pending', kind: 'judging' };
}

function potPanel(bounty) {
  const fee = entryFee(bounty);
  const fees = Number(bounty.entryFeesUsd ?? 0);
  const base = Number(bounty.rewardAmount ?? 0);
  const breakdown =
    fees > 0
      ? `${money(base)} reward + ${money(fees)} in entry fees from ${plural(bounty.entryFeePayers, 'payer', 'payers')}`
      : `${money(base)} reward, the whole pot`;
  const status = statusOf(bounty);
  return `
    <aside class="panel">
      <h2>Live pot</h2>
      <p style="font-size:1.9rem;font-weight:650;margin:.2rem 0"><span class="mono">${pot(bounty)}</span></p>
      <p class="muted" style="margin:.2rem 0 .8rem">${breakdown}</p>
      <dl class="kv">
        <dt>Entry fee</dt><dd>${fee ? fee + ' once per account' : 'none'}</dd>
        <dt>Deadline</dt><dd>${dateTime(bounty.deadline)}</dd>
        <dt>Time left</dt><dd data-left="${esc(bounty.deadline)}"><b>${timeLeft(bounty.deadline)}</b></dd>
        <dt>Entries</dt><dd>${count(bounty.submissionCount)}${bounty.submissionsPassed !== undefined ? ` (${count(bounty.submissionsPassed)} valid)` : ''}</dd>
        <dt>Status</dt><dd><span class="pill ${status.kind}">${status.text}</span></dd>
        <dt>Sponsor</dt><dd>${esc(bounty.sponsor?.name ?? 'make.fun')}${bounty.sponsor?.isVerified ? ' ✓' : ''}</dd>
      </dl>
    </aside>`;
}

function rewardsTable(bounty) {
  const rows = Array.isArray(bounty.rewardsNow) ? bounty.rewardsNow : [];
  if (rows.length === 0) return '<p class="muted">This bounty names no reward places.</p>';
  const withFees = Number(bounty.entryFeesUsd ?? 0) > 0;
  return `
    <table class="rewards">
      <thead><tr><th>Place</th><th>Reward</th>${withFees ? '<th>Fee share</th>' : ''}<th>Pays now</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td>${row.place}${row.place === 1 ? ' 🥇' : row.place === 2 ? ' 🥈' : row.place === 3 ? ' 🥉' : ''}</td>
              <td>${money(row.baseUsd)}</td>
              ${withFees ? `<td>${money(row.feeShareUsd)}</td>` : ''}
              <td><b>${money(row.amountUsd)}</b></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>
    <p class="muted">${count(rows.length)} paid places, ${pot(bounty)} in the pot as it stands${
      withFees ? ', entry fees split over the places awarded' : ''
    }.</p>`;
}

function datesPanel(bounty) {
  const phases = Array.isArray(bounty.phases) ? bounty.phases : [];
  const rows = [
    ['Opened', bounty.opensAt || bounty.publishedAt],
    ['Deadline', bounty.deadline],
  ].filter(([, value]) => value);
  // A phase's own line is written out here, so it is not run through the date reader twice.
  const phaseRows = phases.map((phase) => [
    phase.finalizedAt || phase.finalized_at ? `${phase.title} (settled)` : phase.title,
    `${dateTime(phase.startsAt ?? phase.starts_at)} → ${dateTime(phase.endsAt ?? phase.ends_at)}`,
  ]);
  return `
    <dl class="kv">
      ${rows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${dateTime(value)}</dd>`).join('')}
      ${phaseRows.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}
      <dt>Phases</dt><dd>${phases.length ? count(phases.length) : '—'}</dd>
      <dt>Bundle</dt><dd class="mono">${bounty.bundleSha256 ? esc(String(bounty.bundleSha256).slice(0, 12)) + '…' : '—'}</dd>
    </dl>`;
}

function resolutionPanel(bounty) {
  const resolution = bounty.resolution;
  if (!resolution) return '<p class="muted">This bounty states no resolution in its answer.</p>';
  const criteria = Array.isArray(resolution.criteria) ? resolution.criteria : [];
  return `
    <dl class="kv">
      <dt>Method</dt><dd>${esc(resolution.method ?? '—')}</dd>
      ${resolution.metric ? `<dt>Metric</dt><dd>${esc(resolution.metric.name)} (${esc(resolution.metric.unit)}, ${esc(resolution.metric.better)})</dd>` : ''}
      ${resolution.tieBreak ? `<dt>Tie-break</dt><dd>${esc(resolution.tieBreak)}</dd>` : ''}
    </dl>
    ${resolution.summary ? `<p>${esc(resolution.summary)}</p>` : ''}
    ${criteria.length ? `<details><summary>${count(criteria.length)} criteria</summary><ul>${criteria.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
    ${resolution.verifier ? `<p class="sub">Verifier: ${esc(resolution.verifier)}</p>` : ''}`;
}

function entryRow(entry) {
  const avatar = avatarUrl(entry.image);
  const status = entry.status && entry.status !== 'finished' ? `<span class="pill">${esc(entry.status)}</span>` : '';
  return `
    <li>
      ${avatar ? `<img class="avatar" src="${esc(avatar)}" alt="" width="26" height="26" loading="lazy" decoding="async" crossorigin="anonymous">` : '<span class="avatar" aria-hidden="true"></span>'}
      <span>
        <a href="${profileUrl(entry.handle)}">@${esc(entry.handle)}</a>
        <span class="muted"> — ${esc(entry.title ?? 'untitled entry')}</span>
      </span>
      <span class="sub" style="margin-left:auto">${entry.created_at ? ago(entry.created_at) : ''}</span>
      ${status}
    </li>`;
}

export async function view(ctx) {
  const slug = ctx.route.params.slug;
  const { mount } = ctx;
  const bounty = await get(detailPath(slug), { signal: ctx.signal });
  ctx.setTitle(bounty.title ?? slug);

  const status = statusOf(bounty);
  const fee = entryFee(bounty);
  mount.innerHTML = `
    <p class="crumb"><a href="#/">← All live bounties</a></p>
    <div class="bounty-head">
      <div>
        <h1>${esc(bounty.title ?? slug)}</h1>
        <p class="card-sub">${esc(bounty.sponsor?.name ?? 'make.fun')}${bounty.sponsor?.isVerified ? ' ✓' : ''}
          · ${esc(bounty.category ?? 'uncategorised')} · opened ${dateTime(bounty.opensAt || bounty.publishedAt)}</p>
        <p>${esc(bounty.summary ?? '')}</p>
        <p class="links">
          <a class="button primary" href="${esc(siteUrl(bounty.url))}" target="_blank" rel="noopener noreferrer">Open on make.fun ↗</a>
          <a class="button" href="${leaderboardUrl(slug)}">Leaderboard</a>
          <a class="button" href="#entries">Entries (${count(bounty.submissionCount)})</a>
          <button class="button" type="button" id="copy">Copy link</button>
        </p>
        ${(bounty.prerequisites ? `<p class="sub">Needs: ${esc(bounty.prerequisites.label ?? bounty.prerequisites.summary ?? '')}${bounty.prerequisites.as_of ? ` (checked ${esc(bounty.prerequisites.as_of)})` : ''}</p>` : '')}
      </div>
      ${potPanel(bounty)}
    </div>

    <h2>Rewards</h2>
    ${rewardsTable(bounty)}

    <h2>Dates</h2>
    <div class="panel">${datesPanel(bounty)}</div>

    <h2>Description</h2>
    <div class="prose" id="description"></div>

    <details class="rules">
      <summary>The bounty's rules${bounty.rules ? ` (${count(String(bounty.rules).length)} characters)` : ''}</summary>
      <div class="prose" id="rules"></div>
    </details>

    <h2>How it is judged</h2>
    <div class="panel">${resolutionPanel(bounty)}</div>

    <h2 id="entries">Entries</h2>
    <p class="muted">The newest entries first, ${ENTRIES_PAGE} at a time; every handle opens its public profile.</p>
    <ul class="entries" id="entry-list"></ul>
    <div class="more" id="entry-more"></div>`;

  // The description is rendered now, the rules only when a reader opens them: the rules of a
  // bounty run to tens of thousands of characters and are rarely read at all.
  mount.querySelector('#description').innerHTML = renderMarkdown(bounty.description ?? '', { maxBlocks: 240 });
  const rulesBox = mount.querySelector('#rules');
  const rulesBody = bounty.rules ?? '';
  const rules = mount.querySelector('details.rules');
  rules.addEventListener('toggle', () => {
    if (rules.open && !rulesBox.dataset.rendered) {
      rulesBox.innerHTML = renderMarkdown(rulesBody);
      rulesBox.dataset.rendered = '1';
    }
  });

  mount.querySelector('#copy').addEventListener('click', async (event) => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      event.target.textContent = 'Copied';
    } catch {
      event.target.textContent = 'Press ⌘C';
    }
    setTimeout(() => {
      event.target.textContent = 'Copy link';
    }, 1500);
  });

  const clock = setInterval(() => {
    const now = Date.now();
    for (const node of mount.querySelectorAll('[data-left]')) {
      const value = timeLeft(node.dataset.left, now);
      const bold = node.querySelector('b');
      if (bold && bold.textContent !== value) bold.textContent = value;
    }
  }, 1000);
  ctx.onCleanup(() => clearInterval(clock));

  // Entries: one page now, the next on demand, appended rather than re-rendered.
  const list = mount.querySelector('#entry-list');
  const moreBox = mount.querySelector('#entry-more');
  let cursor = null;
  let loading = false;

  async function page() {
    if (loading) return;
    loading = true;
    moreBox.innerHTML = '<span class="muted">Loading…</span>';
    try {
      const answer = await get(entriesPath(slug, cursor), { signal: ctx.signal });
      const rows = answer.items ?? [];
      list.insertAdjacentHTML('beforeend', rows.map(entryRow).join(''));
      cursor = answer.next_cursor ?? null;
      moreBox.innerHTML = cursor
        ? `<button class="primary" type="button">Show ${ENTRIES_PAGE} more entries</button>`
        : rows.length === 0 && list.children.length === 0
          ? '<span class="muted">No entry is public yet.</span>'
          : `<span class="muted">That is all ${count(list.children.length)} public entries.</span>`;
      moreBox.querySelector('button')?.addEventListener('click', page);
    } catch (error) {
      moreBox.innerHTML = `<span class="muted">Entries did not load (${esc(error.message)}).</span>`;
    } finally {
      loading = false;
    }
  }

  await page();
}
