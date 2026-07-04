---
name: frontend-dev
description: Conventions for writing or modifying frontend code in this repo (vanilla JS/HTML/CSS + Petite-Vue, PWA). Use when adding UI, styling, new views, or touching anything under frontend/. Enforces the existing "Hardcourt Nights" visual identity, the Petite-Vue reactive-island convention, and blocks generic AI-tool defaults (Inter/system-ui text, purple/blue gradients, shadcn-style cards, Tailwind-blue accents).
---
# Frontend Dev

## What this app actually is

`frontend/` is **vanilla JS + HTML + CSS, no build step**. **Petite-Vue** (~6KB, CDN-
loaded) is the sanctioned reactive layer for state/DOM binding going forward — see
"Reactive views with Petite-Vue" below for the adoption status and conventions. FastAPI
serves everything statically via hardcoded per-file routes (see root `CLAUDE.md`). Do
not introduce React, Vue SFCs, JSX, TypeScript, Tailwind, a bundler, or a package.json
for the frontend — none of that fits how this app is built or deployed (no Node
anywhere in Docker/CI, 25 hardcoded FastAPI file routes, 5 HTML files with fixed
`<script>` lists). A build-step framework would be a rewrite; Petite-Vue is a drop-in —
that decision and its full rationale live in the project's frontend-framework plan doc.

Each major view is a standalone page + script:

| Page | HTML | JS | CSS |
|---|---|---|---|
| Admin | `index.html` | `admin-*.js` (split by feature) | `admin.css` |
| Player Hub | `player.html` | `player.js` | `player.css` |
| TV / spectator | (served via router) | `tv.js` | `tv.css` |
| Registration | `register.html` | `register.js` | `register.css` |
| Club landing | `club.html` | `club.js` | `club.css` |

Cross-page utilities live in `shared.js`, `auth.js`, `i18n.js`. Follow the existing
per-page file split — don't merge pages into one script, don't extract a component
framework on top of it.

It is already a working PWA: `manifest.json` + `service-worker.js` (cache-first
static assets, network-first HTML, stale-while-revalidate, web push). Any new page
must be added to `SHELL`/`STATIC_ASSETS` in `service-worker.js` and bump `CACHE_NAME`,
or it will serve stale.

## The design system already exists — use it, don't reinvent it

`theme.css` defines a deliberate identity: **"Hardcourt Nights"** — DecoTurf court
blue, stadium concrete, Penn-ball yellow-green, light "day court" / dark "night
session" modes. This was a conscious departure from generic defaults. Read
`frontend/theme.css` before styling anything new.

- **Fonts**: `--font-display` (Clash Display), `--font-body` (Cabinet Grotesk),
  `--font-data`/`--font-mono` (Roboto/Roboto Mono for tabular scores). Never fall
  back to bare `system-ui`/`-apple-system`/Arial as the *primary* choice for
  headings or brand text — those are already the fallback tail, not the font.
- **Color**: use the `--color-*` tokens (`--color-primary`, `--color-surface`,
  `--color-success`, etc.), not hardcoded hex. Both light and dark values are
  already defined — don't invent a third palette.
- **Radius/shadow/spacing**: use `--radius-*`, `--shadow-*`, `--space-*` tokens.
- Legacy short var names (`--bg`, `--accent`, `--text-muted`, ...) are aliased at
  the bottom of `theme.css` for old component CSS — new code should prefer the
  `--color-*` names directly.

If a new UI need doesn't fit an existing token, add one to `theme.css` in the same
style (named for what it *is* in the court metaphor, with light+dark values) rather
than hardcoding a one-off value in a component file.

## Reactive views with Petite-Vue

**Adoption status**: this is the target convention, not yet fully rolled out. Petite-Vue
gets added via CDN `<script defer>` (pinned version + SRI hash, same pattern as the
existing `marked`/`dompurify`/`chart.js` includes) plus shared `mountIsland()` /
`reactiveStore()` helpers in `shared.js` as infrastructure step zero, then views are
converted incrementally — pilot on the admin create form first (the isolated,
`getElementById`-heaviest form, no SSE involved) to establish the pattern, then the live
SSE views (`tv.js`, `admin-tournaments.js`) where reactivity pays off most, then the rest
of the admin/player/register/club views opportunistically. Check whether `shared.js` has
`mountIsland`/`reactiveStore` yet and whether a given view has been converted before
assuming either is in place — legacy views that still build HTML strings and re-render
by hand are not broken and don't need to change until they're touched.

Canonical recipe once infrastructure lands (this is the pattern to follow — copy it):

- **One reactive store per container**, not one app per page. Use `mountIsland()` /
  `reactiveStore()` from `shared.js` to mount a Petite-Vue app onto a specific root
  element (`v-scope`), not the whole `<body>`. Unconverted containers on the same page
  keep working untouched.
- **`v-model` for form fields**, not `getElementById(id).value` reads on submit. Build
  the request body straight from the store object.
- **`@click`/`@change`/`@input`** bound to store methods, not inline `onclick=`/
  `onchange=` strings baked into rendered HTML.
- **`v-if`/`v-for`** for conditional and repeated markup, not manual
  `element.style.display` toggles or hand-built list HTML.
- **i18n stays inline**: `{{ t('txt_key') }}` / `{{ ts('txt_key', sport) }}` inside
  templates — `t()`/`ts()` (`shared.js`) are plain globals and work unchanged inside
  Petite-Vue expressions. Static (non-reactive) markup keeps using `data-i18n`
  attributes as today.
- **SSE updates mutate the store, they don't trigger a full reload.** In a
  `createVersionStream({ onVersion })` callback, assign new data into the reactive
  store instead of calling a `loadX()` that rebuilds everything — Petite-Vue patches
  only the changed nodes, so open forms and scroll position survive live updates.
- Reuse existing CSS classes/tokens on Petite-Vue-bound markup exactly as before —
  this is a state/rendering change, not a restyle.

Do not add Vue Single-File Components, a router, or any build tooling to make Petite-Vue
"more like Vue" — if the app outgrows Petite-Vue, that's a deliberate, separate decision
(build step, Docker/CI changes, FastAPI route rewrite), not something to back into
incrementally inside this skill's scope.

## Patterns to actively avoid ("AI-tool defaults")

These are generic patterns that don't match this app's identity. Flag/avoid them
even if they're technically fine CSS:

- **Inter, Roboto-as-brand-font, or unstyled `system-ui`** for headings/buttons/nav —
  this app has real display/body fonts, use them.
- **Purple-to-blue gradients** (`linear-gradient(135deg, #6366f1, #8b5cf6)` and
  friends) — not part of this palette. The one legitimate gradient use already in
  the code is amber→red for the demo-mode banner and shimmer skeletons
  (`linear-gradient(90deg, var(--border) ...)`); don't add decorative gradients
  beyond that pattern.
- **Tailwind-default blue** (`#3b82f6`) or **slate-900** (`#0f172a`) as ad hoc
  colors — these are leftover in `manifest.json`'s `theme_color`/`background_color`
  and don't match `theme.css`'s actual `--color-primary` (`#1a5fa3` light /
  `#2e8ad4` dark). Don't propagate them into new code; if you touch
  `manifest.json`, align it to the real theme tokens instead of copying the
  existing mismatch forward.
- **Glassmorphism-by-default** (frosted `backdrop-blur` cards on every panel),
  **rounded-everything at 16–24px**, or a **generic shadcn/Material card stack**
  — this app's radius scale is smaller and more "architectural, crisp like court
  lines" per the `theme.css` comment (`--radius-card: 8px`, not 16–24px).
  `border-radius: 20px` pill shapes only belong on true pills/badges/toggles, not
  cards.
  - Note: `border-radius: 10-12px` on cards is the pre-existing baseline in
    `admin.css`/`club.css`/`player.css` (not the token-defined 8px) — match the
    surrounding file's existing radius rather than "fixing" it ad hoc; migrate to
    `var(--radius-card)` only as a deliberate, reviewed pass.
- **Inline `style=""` gradients/colors for one-off banners** (see the demo-banner
  in `index.html` using a hardcoded amber/red gradient) — new banners/alerts
  should use the `--color-warning-*`/`--color-error-*` tokens and an actual CSS
  class, not inline hex.
- **Emoji as icons in new UI.** The codebase is inconsistent (emoji nav icons
  alongside inline SVG icons elsewhere), but new icons should follow the inline
  `<svg class="ic" viewBox="64 64 896 896" fill="currentColor">` pattern already
  used throughout `index.html`, not emoji — emoji renders inconsistently across
  platforms and reads as a placeholder/AI-generated icon.
- **Boilerplate "AI card" copy patterns**: vague button labels ("Submit",
  "Learn More"), title-case marketing headers, or a hero section with a gradient
  blob — this is an operational tournament tool, copy should be concrete and
  task-specific (see existing strings like "Create Tournament", "Assign courts").

## JS conventions already in use

- Plain functions + JSDoc comments (`/** ... */`) on non-trivial helpers — see
  `shared.js`. No classes-as-components.
- `esc()`/`escAttr()` from `shared.js` for any HTML string interpolation — never
  build HTML via raw template-literal interpolation of user data (XSS risk). Petite-Vue
  templates auto-escape interpolated `{{ }}` text, so this mainly still matters for
  legacy `innerHTML =` string-building.
- **New interactive UI**: bind with Petite-Vue (`@click`, `v-model`) inside a reactive
  island — see "Reactive views with Petite-Vue" above. This supersedes both inline
  `onclick=` and the `data-action="handlerName"` delegated-listener convention as the
  preferred pattern going forward.
- **Legacy code**: `data-action` delegation (real in exactly one file,
  `admin-collaborators.js`) and inline `onclick=` are both still present throughout
  older views — don't rip them out ad hoc; convert a view fully to Petite-Vue when you
  touch it, rather than mixing three event-binding styles in the same file.
- i18n: every user-facing string needs either a `data-i18n="txt_..."` key on static
  markup, or an inline `t('txt_...')`/`{{ t('txt_...') }}` call in rendered/reactive
  content (see `i18n.js` and the `txt_*` key convention) — don't hardcode new UI text
  only in English.
- Feature-flagged/demo-only UI stays behind existing patterns (`DEMO_MODE`), not
  new inline conditionals scattered across files.

## Cross-platform / PWA checklist for new UI

Since this is a single responsive PWA (not separate native builds):
- Design mobile-first for `player.html`/`register.html`/`club.html` — these are
  used courtside on phones. Admin (`index.html`) can assume tablet/desktop but
  must not break on mobile.
- Respect `[data-theme="dark"]` — every new color must have a dark-mode value,
  either via an existing `--color-*` token or a new pair added to both blocks in
  `theme.css`.
- Any new static asset referenced at page load — including any new CDN dependency
  (e.g. the Petite-Vue `<script>` itself, once added) — must be added to
  `service-worker.js`'s `STATIC_ASSETS`/`SHELL`, with `CACHE_NAME` bumped, or users on
  a stale cache won't see it.
- Keep `manifest.json` icons/theme_color in sync if the brand color changes —
  don't let it silently drift from `theme.css` like it currently has.
- Touch targets ≥ 44px on player/register/TV-remote-control surfaces; TV view
  itself must stay legible at distance (large type, high contrast) — see the
  "Mobile/Context fit" section of the `ux-review` skill for the full breakdown
  per view type.

## Before/after a frontend change

1. Check `theme.css` first for an existing token before adding a new color/radius/
   spacing value.
2. Grep the target page's existing CSS file for a similar existing component
   before writing new classes — this codebase reuses `.card`, `.field-section`,
   `.btn`, `.alert`, `.paste-list-btn` etc. extensively; prefer composing those.
3. If you added/renamed a static file under `frontend/`, update
   `service-worker.js` (`STATIC_ASSETS`/`SHELL`, bump `CACHE_NAME`).
4. If you added user-facing text, add the `data-i18n` key and check `i18n.js`.
5. Run a quick dark-mode + mobile-width check before calling it done — this repo
   has no visual regression tooling, so this is manual.
