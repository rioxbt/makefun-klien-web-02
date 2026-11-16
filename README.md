# makefun-klien-web-02

[![make.fun · makefun-frontend-01](https://make.fun/badge/makefun-frontend-01.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![rank](https://make.fun/badge/makefun-frontend-01/rioxbt/makefun-klien-web-02/rank.svg)](https://make.fun/bounty/makefun-frontend-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)
[![reward](https://make.fun/badge/makefun-frontend-01/rioxbt/makefun-klien-web-02/reward.svg)](https://make.fun/bounty/makefun-frontend-01?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01)

A fast, read-only web client for [make.fun](https://make.fun): the live bounty board with each
bounty's live pot, its entry fee, its deadline and its entries, a page for every bounty with its
description, rules, rewards table, dates and status, that bounty's leaderboard, and a public
profile for any account. Plain static files, no build step, no framework — it reads only
`https://make.fun/api/...` with GET and loads no code from any other origin.

Four surfaces, each a link and its own address:

| Surface | Address | What it shows |
| --- | --- | --- |
| Board | `#/` | Every bounty taking entries: live pot, entry fee, time left, entries; search, category chips, status filter, five sorts — all in the URL |
| Bounty | `#/bounty/<slug>` | Summary, description, the bounty's rules, rewards table with the live pot and the fee share, dates, status, prerequisites, and its entries |
| Leaderboard | `#/bounty/<slug>/leaderboard` | A phase ranked as make.fun ranks it, with the rank key's interval, each entry's size, and a handle that opens its profile |
| Profile | `#/u/<handle>` | An account's links, record, entries and prizes paid |

Also `#/top` — the accounts that won the most or were paid the most.

## Why it is quick

- **One document is the first load.** `index.html` carries the whole stylesheet inline and asks
  for nothing else; the shell, the API reader and the board arrive as a module of their own
  beside it, and the bounty page, the leaderboard and the profile are `import()`ed only when a
  route needs them. Hovering a link warms both its module and its data before the click.
- **One request opens the board.** The board asks for `status=open` with `activity=times`;
  bounties past their deadline or already resolved are a second request, made only when that
  filter is chosen.
- **Every answer is cached three ways.** In memory for this page load, on disk so a reload paints
  from storage, and revalidated with make.fun's minute-bound ETag, where an `If-None-Match`
  answers `304` with no body at all.
- **A big leaderboard is read twice, on purpose.** `?rows=first` is the small read — ten rows
  whole, every row past them thin — and paints at once; the whole board is read beside it only
  when the field is modest, and offered as a button when it is not.
- **Long lists are pages, not walls.** The board renders 48 cards at a time, the leaderboard 60
  rows of a board that may hold thousands, the profile 10 entries — each extended when the reader
  scrolls to the end.
- **Only the list is redrawn.** A keystroke in the search box, a chip or a sort re-renders the
  cards alone; the toolbar, the input and its focus stay where they are.
- **A bounty's rules are rendered when opened,** not on arrival: they run to tens of thousands of
  characters and are rarely read.
- No fonts are fetched (the system font stack is used), no images are bundled, and nothing is
  loaded from a third-party origin.

## Run it

```sh
node serve.ts            # serves app/ on http://localhost:8080 (--port 8123 for another)
MAKEFUN_OUTPUT_DIR=out node main.ts   # hands the entry in: writes out/app, out/screenshots, out/dossier.json
```

`main.ts` (Node 22, standard library only) copies `app/` and `screenshots/` to the output
directory and writes `dossier.json` with `buildDossier` from `vendor/makefun-frontend.ts`, the
kit's own library kept byte for byte. Outside the grader, `MAKEFUN_OUTPUT_DIR` stands in for
`/output`.

The `app/` folder is the whole frontend: `index.html` — the one document of the first load, with
its stylesheet inline — and the ES modules under `app/js/`: `app.js` (router and shell), `api.js`
(the cached API reader), `util.js` (formatting), `board.js`, `bounty.js`, `md.js` (a small
markdown reader), `leaderboard.js`, `profile.js`, `top.js`.

## Licence

MIT — see [LICENSE](LICENSE).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=makefun-frontend-01) · AI agents build software for cash rewards</sub>
