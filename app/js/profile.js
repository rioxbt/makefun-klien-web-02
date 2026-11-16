// An account's public profile: its links, its record, the entries it has made and the prizes
// it has been paid — the four blocks make.fun's own /api/profiles/:handle answers with.
//
// Nothing here is signed in and nothing is private: a link the account hides arrives null and
// a withheld source is left as a line of text rather than invented.

import { get } from './api.js';
import { ago, bountyUrl, count, dateTime, esc, money, plural, scoreText, siteUrl } from './util.js';

const SOLUTIONS_PAGE = 10;

const profilePath = (handle) => '/profiles/' + encodeURIComponent(handle);

const linkRow = (profile) => {
  const links = [];
  if (profile.github_login) links.push(`<a href="${esc('https://github.com/' + profile.github_login)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>`);
  if (profile.discord?.url) links.push(`<a href="${esc(profile.discord.url)}" target="_blank" rel="noopener noreferrer">Discord${profile.discord.global_name ? ' · ' + esc(profile.discord.global_name) : ''} ↗</a>`);
  if (profile.x?.url) links.push(`<a href="${esc(profile.x.url)}" target="_blank" rel="noopener noreferrer">X${profile.x.username ? ' · @' + esc(profile.x.username) : ''} ↗</a>`);
  if (profile.wallet?.address) links.push(`<a href="${esc(profile.wallet.explorer_url)}" target="_blank" rel="noopener noreferrer">Wallet ${esc(profile.wallet.address.slice(0, 4))}…${esc(profile.wallet.address.slice(-4))} ↗</a>`);
  links.push(`<a href="${esc(siteUrl(profile.profile_url))}" target="_blank" rel="noopener noreferrer">On make.fun ↗</a>`);
  return `<div class="links">${links.join('')}</div>`;
};

const recordCells = (record = {}) => {
  const cells = [
    ['Entered', count(record.competitions_entered)],
    ['Won', count(record.competitions_won)],
    ['Podium', count(record.podium_finishes)],
    ['Placed', count(record.competitions_placed)],
    ['Best place', record.best_placement ? '#' + record.best_placement : '—'],
    ['Prize paid', money(record.prize_usd)],
  ];
  return `<div class="record">${cells.map(([label, value]) => `<div class="cell"><b>${value}</b><span>${label}</span></div>`).join('')}</div>`;
};

function solutionRow(solution) {
  const competition = solution.competition ?? {};
  const score = solution.score ? `${esc(scoreText(solution.score))} <span class="sub">${esc(solution.score.column?.title ?? '')}</span>` : '';
  const place = solution.placement ? `<span class="badge">#${solution.placement}</span>` : '';
  const prize = Number(solution.prize_usd ?? 0) > 0 ? `<span class="badge">${money(solution.prize_usd)}</span>` : '';
  return `
    <li>
      <div class="solution-top">
        <a class="title" href="${esc(siteUrl('/s/' + solution.submission_id))}" target="_blank" rel="noopener noreferrer">${esc(solution.title ?? 'untitled entry')}</a>
        ${place}${prize}
        <span class="sub" style="margin-left:auto">${solution.entered_at ? ago(solution.entered_at) : ''}</span>
      </div>
      <div class="sub">
        in <a href="${bountyUrl(competition.slug)}">${esc(competition.title ?? competition.slug)}</a>
        · ${esc(competition.category ?? '')}${competition.reward_usd ? ` · ${money(competition.reward_usd)} reward` : ''}
        · ${esc(competition.status ?? '')}
        ${score ? ` · scored ${score}` : ''}
      </div>
    </li>`;
}

export async function view(ctx) {
  const handle = ctx.route.params.handle;
  const { mount } = ctx;
  let profile;
  try {
    profile = await get(profilePath(handle), { signal: ctx.signal });
  } catch (error) {
    if (error.status === 404) return missing(mount, handle);
    throw error;
  }
  if (profile?.success === false) return missing(mount, handle);

  ctx.setTitle('@' + (profile.handle ?? handle));
  const image = profile.image ?? profile.avatar?.url_small ?? null;
  const solutions = Array.isArray(profile.solutions) ? profile.solutions : [];
  const payouts = Array.isArray(profile.payouts) ? profile.payouts : [];

  mount.innerHTML = `
    <p class="crumb"><a href="#/">← All live bounties</a> · <a href="#/top">Top accounts</a></p>
    <div class="profile-head">
      ${image ? `<img class="avatar lg" src="${esc(image.startsWith('http') ? image : 'https://make.fun' + image)}" alt="" width="56" height="56" decoding="async" crossorigin="anonymous">` : '<span class="avatar lg" aria-hidden="true"></span>'}
      <div>
        <h1 style="margin:0">@${esc(profile.handle)}${profile.display_name ? ` <span class="muted" style="font-size:1rem">${esc(profile.display_name)}</span>` : ''}</h1>
        <p class="muted" style="margin:.2rem 0">
          ${profile.house ? '<span class="badge">house</span> ' : ''}${profile.demo ? '<span class="badge">demo</span> ' : ''}
          joined ${dateTime(profile.joined_at)}
        </p>
        ${linkRow(profile)}
      </div>
    </div>
    ${profile.bio ? `<p>${esc(profile.bio)}</p>` : ''}
    <h2>Record</h2>
    ${recordCells(profile.record)}
    <p class="muted">Counted from public entries in published competitions; places only from resolved ones.</p>

    <h2>Entries (${count(solutions.length)})</h2>
    <ul class="solutions" id="solutions"></ul>
    <div class="more" id="solutions-more"></div>

    <h2>Prizes paid (${count(payouts.length)})</h2>
    ${payouts.length === 0 ? '<p class="muted">No prize paid to this account yet.</p>' : ''}
    ${payouts
      .slice(0, 12)
      .map(
        (payout) => `<p class="sub">${money(payout.amount_usd)} · place ${payout.place ?? '—'} ·
          <a href="${bountyUrl(payout.competition?.slug)}">${esc(payout.competition?.title ?? '')}</a> ·
          ${dateTime(payout.paid_at)} · <a href="${esc(payout.explorer_url)}" target="_blank" rel="noopener noreferrer">${esc(payout.signature?.slice(0, 8) ?? 'transaction')}… ↗</a></p>`,
      )
      .join('')}
    ${payouts.length > 12 ? `<p class="muted">${plural(payouts.length - 12, 'older prize', 'older prizes')} not shown.</p>` : ''}`;

  // Twenty entries at a time: a prolific account has thirty-six, and the page opens at once.
  const list = mount.querySelector('#solutions');
  const moreBox = mount.querySelector('#solutions-more');
  let page = 1;

  function paintSolutions() {
    const slice = solutions.slice(0, page * SOLUTIONS_PAGE);
    list.innerHTML = slice.map(solutionRow).join('');
    moreBox.innerHTML =
      slice.length < solutions.length ? `<button class="primary" type="button">Show ${Math.min(SOLUTIONS_PAGE, solutions.length - slice.length)} more entries</button>` : '';
    const button = moreBox.querySelector('button');
    if (button) button.addEventListener('click', () => { page += 1; paintSolutions(); });
  }

  paintSolutions();
}

function missing(mount, handle) {
  mount.innerHTML = `
    <p class="crumb"><a href="#/">← All live bounties</a></p>
    <h1>No account @${esc(handle)}</h1>
    <p class="muted">make.fun has no public profile for that handle. <button class="ghost" type="button" id="back">Back to the board</button></p>`;
  mount.querySelector('#back').addEventListener('click', () => {
    location.hash = '#/';
  });
}
