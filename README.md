# TurdPolisher

A single-file, no-build movie/TV recommendation page. It pulls candidates
from three sources — TMDB's discover API, community suggestion threads on
Reddit, and an optional LLM (Claude or Gemini) — filters out a personal
deny-list (actors, titles, genres, keyword categories) and anything not
in English, scores the rest against what you've dismissed before, and
shows five picks at a time as poster cards (top cast listed on each).
Each poster is split into two big tap zones — green 👍 top half to mark
watched, red 👎 bottom half to dismiss — and the title links straight to
Radarr/Sonarr's add page.

Open `index.html` in a browser — there's nothing to install or build.

## Installing it as an app (Android)

Once served over HTTPS (i.e. from the GitHub Pages copy, not a local
`file://` open — a service worker needs a secure context), Chrome on
Android offers a real install:

1. Open the hosted URL in Chrome.
2. Tap the **⋮** menu → **Install app** (or **Add to Home screen**).
3. It launches full-screen with no address bar, from its own home-screen
   icon, and keeps working offline for the shell UI (the actual
   recommendations still need a network connection, same as any other
   time — only the page itself is cached).

This is a standard installable web app (manifest + service worker), not
a packaged `.apk` — no separate download, and it stays in sync with
whatever's deployed at the hosted URL.

## Setup

1. Open `index.html`. With no TMDB key saved yet, Settings opens
   automatically.
2. Add a free TMDB API key (Settings → TMDB has step-by-step signup links).
   This is the only required credential — everything else is optional.
3. Optionally add an LLM API key for up to 2 AI-suggested titles per
   round, tuned to your genre, mood word, and deny-list. One field, two
   providers, auto-detected from the key prefix: `sk-ant-…` →
   Anthropic (`claude-opus-5`, pay-per-use — a round costs a fraction of
   a cent; direct browser calls via the
   `anthropic-dangerous-direct-browser-access` header, CORS verified
   live) or `AIza…` → Google Gemini (`gemini-2.5-flash`, free tier,
   CORS verified live). The model only ever proposes `{title, year}`
   candidates; each is resolved through TMDB search and passes exactly
   the same filters as every other pick, badged "✷ Claude pick" /
   "✷ Gemini pick" on the card. No key → no requests, zero behavior
   change.
4. Radarr/Sonarr addresses default to `192.168.1.9:7878` / `:8989` (this
   repo's home-lab server, see `docs/runbooks/`) — change them if your
   server's address differs. Each card's title links to `<host>/add/new?term=<title>`
   on whichever app matches the current Movie/TV mode.

## How recommendations are picked

1. `resolveKeywords` turns the free-text mood/angle box into TMDB keyword
   IDs, OR'd together: the top 5 tags for the word itself plus the top 2
   for each of its expansion terms from `VIBE_EXPANSIONS` — a built-in
   table (curated from an audit of which vibe words actually resolve to
   populated TMDB tags) mapping words like "cozy", "slow burn", or
   "frenetic", whose own tags are sparse or missing, to related terms
   that are well-tagged ("heartwarming", "suspense", "fast-paced").
2. Up to three candidate pools are fetched in parallel:
   - `/discover/{movie,tv}` filtered by genre chip + mood keywords +
     minimum vote count + English original language. Three random pages
     are sampled from up to the top 25 pages of the query (~500 titles per
     combo). If the pool comes back thin the query widens progressively —
     drop the genre, then the mood keywords, then plain discover — instead
     of dead-ending; the status line says when the mood word had to be
     dropped from the TMDB side (Reddit keeps using it regardless).
   - Reddit: the mood text (or "<genre> hidden gems") is searched on two
     subreddits per mode — r/MovieSuggestions or r/televisionsuggestions,
     plus r/ifyoulikeblank (with a movie/show hint added to its query).
     The top 4 threads' posts and top-level comments per sub are scanned
     for **bold** and "quoted" title mentions (up to 16 candidates each),
     resolved to real entries via TMDB search, and deduped across subs.
     The whole Reddit phase is capped at 10 seconds so one slow subreddit
     can't stall the round. Everything Reddit-sourced still goes through
     the same filters below.
   - LLM (only when a key is saved): the genre, mood word, and deny-list
     go into a prompt asking for 8 lesser-known titles as a strict JSON
     array; the reply is fence-stripped, parsed, resolved via TMDB
     search, and filtered like everything else. Capped at ~22 seconds
     and fails soft ("AI picks unavailable this round").
3. A coarse filter drops anything not in English, already
   seen/dismissed/soft-excluded, matching a hard-excluded genre (animation,
   family/kids, talk/news-ish), or a title on the exclusion list.
4. The remaining pool is ranked by vote average minus a penalty for genres
   you've dismissed before, and the shortlist (up to 8 Reddit picks plus
   the top 24 discover results) gets a per-title keyword + top-10-cast
   check against the superhero/panel-show keyword blocklist and the
   excluded-people list. The top 3 billed cast members are kept for
   display on the card.
5. The first 5 clean results are shown — at most 2 Reddit-sourced
   ("via r/…" badge) leading, then at most 2 LLM-sourced ("Claude pick"
   / "Gemini pick" badge); the rest are kept in
   memory so dismissing or marking a card watched swaps in the next clean
   pick without another round trip. When dismissals run that reserve low,
   another discover batch (matching the same genre/mood) is fetched and
   screened in the background, so the grid keeps refilling for as long as
   the query has titles left.

Dismissing a title also soft-excludes its top 6 "similar" titles from TMDB,
and each dismissal nudges down that title's genres for future ranking.

### Why Reddit, and only Reddit

A static page can only read sites that explicitly allow cross-origin
browser requests. Reddit's public JSON API does (the page tries
`api.reddit.com` first, falling back to `www.reddit.com/*.json`); most
other community sources — Letterboxd, forums, blogs — don't, so they can't
be scraped from client-side JS at all. If Reddit is unreachable or blocks
the request, the round quietly falls back to TMDB-only picks and the
status line says so. Reddit also rate-limits and sometimes blocks
unauthenticated traffic, so treat this as best-effort seasoning, not the
backbone.

## State and storage

All settings, exclusions, and watched/dismissed history are kept in the
browser's `localStorage` under a `turdpolisher:` key prefix — nothing is
sent anywhere except TMDB (and, best-effort, Reddit and the optional LLM
provider). That also means state is per-browser: there's no sync between
devices, and clearing site data resets everything. A TMDB key entered
here is likewise only ever stored locally and sent directly to
`api.themoviedb.org` — never commit one into this repo.

## Broken IPv6 (TMDB timeouts)

`api.themoviedb.org` advertises IPv6 addresses but its IPv6 service has a
long history of not responding, so on an IPv6-enabled connection requests
can hang rather than fail — the same issue the Radarr/Sonarr community
hits constantly. A web page can't pick the address family (the browser
and OS decide), so the page's defense is a timeout: every request aborts
after ~8 seconds and falls into the normal fallback path (clear status
message; Reddit failures degrade to TMDB-only picks).

The real fix is on the device or router. On Windows, prefer IPv4 without
disabling IPv6 (run as admin, then reboot):

```
reg add "HKLM\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters" /v DisabledComponents /t REG_DWORD /d 0x20 /f
```

Revert later with the same command and `/d 0x0`. If Radarr/Sonarr on the
media server also show TMDB/metadata timeouts, apply the same fix there —
they talk to the same broken endpoint.

## Theme

OLED-black page (`#000`), near-black card surfaces, teal (`--teal`/`--teal-2`/`--teal-3`)
for structure and headings, orange (`--burnt-orange`/`--coral`) for CTAs and
highlights. Card and drawer edges use a low-alpha teal glow instead of a drop
shadow, since a dark shadow doesn't read against a true-black page.

## Notes

The original draft called a `window.storage.get`/`.set` API that doesn't
exist in a plain browser (it would throw immediately on load and never
render). `storageGet`/`storageSet` now wrap `localStorage` directly, kept
behind the same `Promise`-returning interface so the rest of the file is
unchanged.
