// The accounts that won the most, or were paid the most: make.fun's own ranking, one page of
// fifty at a time, with each handle opening its profile. This is the view a profile page
// leads back to, and what a board of bounties cannot say by itself.

import { get } from './api.js';
import { count, dateTime, esc, money, profileUrl, urlFor, whenVisible } from './util.js';

const RANKINGS_PAGE = 50;
const ORDERS = {
  wins: 'Competitions won',
  paid: 'Prize money paid',
};

const rankingsPath = (order, cursor) =>
  '/rankings?limit=' + RANKINGS_PAGE + '&order=' + encodeURIComponent(order) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');

function row(item) {
  const image = item.image ?? item.avatar?.url_small ?? null;
  const record = item.record ?? {};
  return `
    <tr>
      <td class="rank${item.rank <= 3 ? ' top' : ''}">${item.rank}</td>
      <td>
        <span class="handle">
          ${image ? `<img class="avatar" src="${esc(image.startsWith('http') ? image : 'https://make.fun' + image)}" alt="" width="24" height="24" loading="lazy" decoding="async" crossorigin="anonymous">` : '<span class="avatar" aria-hidden="true"></span>'}
          <a class="who" href="${profileUrl(item.handle)}">@${esc(item.handle)}</a>
        </span>
      </td>
      <td class="num">${count(record.competitions_won)}</td>
      <td class="num">${count(record.podium_finishes)}</td>
      <td class="num">${count(record.competitions_placed)}</td>
      <td class="num">${count(record.competitions_entered)}</td>
      <td class="num">${money(record.prize_usd)}</td>
    </tr>`;
}

export async function view(ctx) {
  const order = ORDERS[ctx.query.get('order')] ? ctx.query.get('order') : 'wins';
  const { mount } = ctx;
  ctx.setTitle('Top accounts');
  const first = await get(rankingsPath(order, null), { signal: ctx.signal });

  mount.innerHTML = `
    <p class="crumb"><a href="#/">← All live bounties</a></p>
    <h1>Top accounts</h1>
    <p class="muted">Ranked by ${esc(ORDERS[order].toLowerCase())} on make.fun, counted from public entries in published,
    resolved competitions. A handle opens its profile.</p>
    <div class="tabs">
      ${Object.entries(ORDERS)
        .map(
          ([key, label]) =>
            `<a class="button"${key === order ? ' aria-current="page"' : ''} href="${urlFor('top', {}, '?order=' + key)}">${label}</a>`,
        )
        .join('')}
    </div>
    <div class="table-wrap">
      <table class="rows">
        <thead>
          <tr><th>#</th><th>Account</th><th class="num">Won</th><th class="num">Podium</th><th class="num">Placed</th><th class="num">Entered</th><th class="num">Prize paid</th></tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <div class="more" id="more"></div>`;

  const body = mount.querySelector('#rows');
  const moreBox = mount.querySelector('#more');
  const items = Array.isArray(first.items) ? first.items : [];
  let cursor = first.next_cursor ?? null;

  const append = (rows) => body.insertAdjacentHTML('beforeend', rows.map(row).join(''));

  function announcePage() {
    moreBox.innerHTML = cursor
      ? `<button class="primary" type="button">Show ${RANKINGS_PAGE} more accounts</button>`
      : `<span class="muted">${count(body.children.length)} accounts${first.updated_at ? ` · as of ${dateTime(first.updated_at)}` : ''}</span>`;
    const button = moreBox.querySelector('button');
    if (button) {
      const extend = async () => {
        button.disabled = true;
        button.textContent = 'Loading…';
        try {
          const next = await get(rankingsPath(order, cursor));
          append(next.items ?? []);
          cursor = next.next_cursor ?? null;
          announcePage();
        } catch (error) {
          moreBox.innerHTML = `<span class="muted">Did not load: ${esc(error.message)}</span>`;
        }
      };
      button.addEventListener('click', extend);
      whenVisible(moreBox, extend, '400px');
    }
  }

  append(items);
  announcePage();
}
