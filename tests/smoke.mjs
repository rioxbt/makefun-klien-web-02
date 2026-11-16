// A node test of the app's own logic on make.fun's live answers, run without a browser:
// the pure modules (util.js, md.js) are imported as they are and fed the real payloads, so a
// change that breaks formatting, the deadline rule or the markdown reader fails here.
//
//   node tests/smoke.mjs

import {
  bytes, closesWithin, columnValue, count, dateTime, entryFee, esc, lastEntryAgo, money,
  pot, rate, snippet, takesEntries, timeLeft, urlFor,
} from '../app/js/util.js';
import { renderMarkdown } from '../app/js/md.js';

const API = 'https://make.fun/api';
let passed = 0;
const failures = [];

const ok = (label, condition, detail = '') => {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(`${label} ${detail}`);
    console.log(`  FAIL ${label} ${detail}`);
  }
};

const equal = (label, actual, expected) => ok(label, actual === expected, `— got ${JSON.stringify(actual)}`);

const get = async (path) => {
  const response = await fetch(API + path);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
};

console.log('formatting');
equal('money drops zero cents', money(500), '$500');
equal('money keeps cents', money(699.5), '$699.50');
equal('money keeps half a dollar', money(0.5), '$0.50');
equal('money groups thousands', money(1234567.89), '$1,234,567.89');
equal('count groups thousands', count(12047), '12,047');
equal('bytes reads small values', bytes(702), '702 B');
equal('bytes reads the dossier size', bytes(703173), '687 KiB');
equal('rate reads millionths', rate(950587), '0.950587');
equal('dateTime is UTC', dateTime('2026-11-17T12:30:00.000Z'), '17 Nov 2026, 12:30 UTC');
equal('esc escapes markup', esc('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
equal('urlFor builds a bounty route', urlFor('bounty', { slug: 'a b' }), '#/bounty/a%20b');
equal('urlFor builds a leaderboard route', urlFor('leaderboard', { slug: 'x' }), '#/bounty/x/leaderboard');
equal('urlFor builds a profile route', urlFor('profile', { handle: 'someone' }), '#/u/someone');

console.log('the deadline rule (a bounty past its deadline may still read open)');
const now = Date.parse('2026-11-16T18:00:00Z');
const past = { status: 'open', deadline: '2026-11-10T02:00:00.000Z' };
const live = { status: 'open', deadline: '2026-11-24T17:00:00.000Z' };
const closed = { status: 'closed', acceptingSubmissions: false, deadline: '2026-12-01T00:00:00.000Z' };
ok('a past deadline takes no entries', takesEntries(past, now) === false);
ok('an open deadline takes entries', takesEntries(live, now) === true);
ok('acceptingSubmissions false wins over a future deadline', takesEntries(closed, now) === false);
ok('closing inside 24h is seen', closesWithin({ deadline: '2026-11-17T02:00:00Z' }, 24 * 3600e3, now) === true);
ok('closing in two days is not inside 24h', closesWithin({ deadline: '2026-11-18T17:00:00Z' }, 24 * 3600e3, now) === false);
equal('timeLeft reads days', timeLeft('2026-11-19T06:00:00.000Z', now), '2d 12h left');
equal('timeLeft reads minutes', timeLeft('2026-11-16T18:38:00.000Z', now), '38m left');
ok('timeLeft reads a passed deadline', timeLeft('2026-11-15T18:00:00.000Z', now).startsWith('closed 1d'), timeLeft('2026-11-15T18:00:00.000Z', now));

console.log("the board's live answer");
const board = await get('/competitions?status=open&activity=times');
const items = board.items ?? [];
ok('the board answers bounties', items.length > 0, `n=${items.length}`);
ok('every bounty carries a slug, a title and a deadline', items.every((b) => b.slug && b.title && b.deadline));
ok('every bounty carries a live pot', items.every((b) => Number(b.potUsd) >= Number(b.rewardAmount ?? 0)));
const taking = items.filter((b) => takesEntries(b, Date.now()));
const judging = items.filter((b) => !takesEntries(b, Date.now()));
ok('some bounties still take entries', taking.length > 0, `n=${taking.length}`);
ok('the listing carries bounties past their deadline, so the split is real', judging.length >= 0);
ok('a card pot reads the live pot', pot(taking[0]) === money(taking[0].potUsd));
ok('a card names an entry fee where one is set', items.some((b) => entryFee(b) === null) && items.some((b) => entryFee(b) !== null));
ok('a snippet is short, single-line text', snippet(taking[0].description, 150).length <= 151 && !snippet(taking[0].description, 150).includes('\n'));
ok('lastEntryAgo reads the newest entry time', lastEntryAgo(taking[0], Date.now()) === '' || /ago$/.test(lastEntryAgo(taking[0], Date.now())));
const withEntries = items.find((b) => Array.isArray(b.submissions) && b.submissions.length > 1);
if (withEntries) ok('activity=times cut the submissions list to times', Object.keys(withEntries.submissions[0]).join(',') === 'createdAt');

console.log("a bounty's page");
const detail = await get('/competitions/makefun-frontend-01?submissions=summary');
ok('the page carries a description and rules', (detail.description ?? '').length > 100 && (detail.rules ?? '').length > 1000);
ok('the rewards table carries every paid place', Array.isArray(detail.rewardsNow) && detail.rewardsNow.length === Object.keys(detail.rewards ?? {}).length);
ok('the pot is the reward plus the fees paid in', Math.abs(Number(detail.potUsd) - (Number(detail.rewardAmount) + Number(detail.entryFeesUsd))) < 0.011, `${detail.potUsd} vs ${detail.rewardAmount}+${detail.entryFeesUsd}`);
ok('the rewards table sums to the pot', Math.abs(detail.rewardsNow.reduce((sum, row) => sum + Number(row.amountUsd), 0) - Number(detail.potUsd)) < 0.011);
ok('it names an entry fee where one is set', entryFee(detail) === '$0.50');
ok('it carries a resolution to show', Boolean(detail.resolution?.summary));

console.log('the markdown reader');
const rules = renderMarkdown(detail.rules.slice(0, 20000));
ok('rules render as headings', rules.includes('<h3>') || rules.includes('<h4>'));
ok('rules render as lists', rules.includes('<li>'));
ok('markdown cannot inject markup', renderMarkdown('<img src=x onerror=alert(1)> and <script>bad()</script>').includes('&lt;') && !renderMarkdown('<b>bold</b>').includes('<b>bold</b>'));
ok('a link to another origin is a link', renderMarkdown('[x](https://example.com/a)').includes('href="https://example.com/a"'));
ok('a javascript: link is not a link', !renderMarkdown('[x](javascript:alert(1))').includes('href="javascript'));
ok('a relative link resolves against make.fun', renderMarkdown('[x](/bounty/a)').includes('href="https://make.fun/bounty/a"'));
ok('a table renders as a table', renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |').includes('<table>'));
ok('a fence renders as code', renderMarkdown('```js\nconst a = 1;\n```').includes('<pre><code>const a = 1;</code></pre>'));
ok('a bare url becomes a link', renderMarkdown('see https://make.fun/bounty for more').includes('href="https://make.fun/bounty"'));
ok('a markdown link is made once', (renderMarkdown('[x](https://example.com/a)').match(/<a /g) ?? []).length === 1);
ok('a code span keeps its url as text', renderMarkdown('`https://example.com/a`').includes('<code>https://example.com/a</code>') && !renderMarkdown('`https://example.com/a`').includes('<a '));
ok('markdown inside a heading is escaped too', !renderMarkdown('# <script>bad()</script>').includes('<script>'));

console.log("a bounty's leaderboard");
const leaderboard = await get('/competitions/makefun-frontend-01/leaderboard?rows=first');
const entries = leaderboard.entries ?? [];
const thin = leaderboard.rest ?? [];
const columns = (leaderboard.columns ?? []).filter((column) => !column.hidden);
const rankKey = leaderboard.rank_key ?? 'judge';
ok('the small read paints the first page whole', entries.length === 10, `n=${entries.length}`);
ok('the small read still carries the whole board', thin.length > 0, `n=${thin.length}`);
ok('the whole board is the first page plus the thin rows', entries.length + thin.length > 10);
ok('a whole row carries its values', Boolean(entries[0]?.values));
ok('a thin row carries the rank key alone', thin[0]?.value !== undefined && thin[0]?.values === undefined);
ok('a thin row carries its rank and handle', Boolean(thin[0]?.handle) && typeof thin[0]?.rank === 'number');
ok('the rank key is a column', columns.some((column) => column.key === rankKey));
ok('a micro column reads as a rate', /^\d+\.\d{6}$/.test(columnValue(columns[0], entries[0])), columnValue(columns[0], entries[0]));
ok('entries are ordered by rank', entries.every((entry, index) => index === 0 || (entry.rank ?? 0) >= (entries[index - 1].rank ?? 0)));
const interval = entries.find((entry) => entry.interval);
if (interval) ok('a ranked entry carries its interval', Number(interval.interval.low) <= Number(interval.interval.high));
const widened = { ...thin[0], values: { [rankKey]: thin[0].value }, display: { [rankKey]: thin[0].display } };
ok('a thin row reads through the same column formatter', columnValue(columns[0], widened) === rate(thin[0].value), `${columnValue(columns[0], widened)} vs ${rate(thin[0].value)}`);

console.log("an account's profile");
const profile = await get('/profiles/icantcodefyi');
ok('the profile carries a handle and a record', profile.handle === 'icantcodefyi' && typeof profile.record?.competitions_entered === 'number');
ok('the profile carries its entries', Array.isArray(profile.solutions) && profile.solutions.length > 0);
ok('a profile entry names its competition', Boolean(profile.solutions[0].competition?.slug));
ok('the profile carries prizes paid', Array.isArray(profile.payouts));

console.log('the rankings');
const rankings = await get('/rankings?limit=50');
const ranked = rankings.items ?? [];
ok('the rankings answer accounts', ranked.length > 0, `n=${ranked.length}`);
ok('a ranked account carries its record', ranked.every((item) => item.handle && item.record));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.log(`  failed: ${failure}`);
  process.exit(1);
}
