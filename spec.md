# Bếp Phương Bắc — Preorder Management

## 1. Goal
A simple, mobile-first app for a small kitchen to manage preorders: see what must be delivered on a given day, tick off orders as delivered, and let other systems (e.g. chatbot, Zalo/Messenger integration, forms) create/update orders through an API.

**Main features**
1. List orders for today (default view).
2. Pick a date and list orders for that day.
3. Confirm an order as delivered (and undo).
4. API for other systems to create/update orders.

**Non-goals (v1):** payments, inventory, menu/pricing, customer accounts, multi-shop, notifications.

## 2. Tech stack
| Layer | Choice |
|---|---|
| Frontend | Vue 3 (Composition API, `<script setup>`), Vite, TypeScript, Vue Router (optional), `@supabase/supabase-js` |
| Backend | Supabase (Postgres, Auth, RLS, Realtime, Edge Functions) |
| Hosting | GitHub Pages (static, built by GitHub Actions); Supabase hosted |
| Tests | Vitest (unit), Playwright (e2e smoke), pgTAP or SQL tests for RLS |

Constraints: GitHub Pages is static → no secrets in the frontend (only Supabase URL + anon key); all privileged logic lives in RLS or Edge Functions. Vite `base` must be set to the repo name; use hash-mode routing (or a single page) to avoid 404s on refresh.

## 3. Users & roles
- **Staff** (kitchen owner/helpers): signs in, views and marks orders. Full access.
- **Integration** (other system): calls the Order API with an API key. No UI.
- No anonymous access to order data.

## 4. Data model

### `orders`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `external_id` | text, nullable | caller's id, used for idempotent upsert |
| `source` | text, default `'manual'` | integration name, e.g. `messenger`; part of unique key |
| `customer_name` | text, not null | shown as NAME |
| `quantity` | int, not null, `> 0` | shown as QTY. (portions / "suất") |
| `message` | text, default `''` | free text from customer (Vietnamese, emoji allowed) |
| `delivery_date` | date, not null | local date in `Asia/Ho_Chi_Minh` |
| `delivered` | boolean, default false | |
| `delivered_at` | timestamptz, nullable | set when `delivered` becomes true, cleared on undo |
| `delivered_by` | uuid → `auth.users`, nullable | |
| `placed_at` | timestamptz, not null, default `now()` | when the customer placed the order (e.g. Zalo message time); shown under NAME as `HH:mm` |
| `created_at` / `updated_at` | timestamptz | row insert time / `updated_at` via trigger |

Constraints / indexes
- `unique (source, external_id)` where `external_id is not null`.
- Index on `(delivery_date, delivered, placed_at)`.
- Optional later: `phone`, `address`, `note` columns (kept out of v1).

### `api_keys`
`id`, `name`, `key_hash` (SHA-256, never store plaintext), `created_at`, `revoked_at`, `last_used_at`. Only the Edge Function (service role) reads this table; no RLS policy for clients.

### Row Level Security (`orders`)
- RLS enabled.
- `select`, `update` (only `delivered`, `delivered_at`, `delivered_by` from the UI; enforced by a column-restricted RPC or trigger) and `insert`/`delete` for `authenticated` users on the allow-list (`staff` table or `app_metadata.role = 'staff'`).
- No policies for `anon`.

## 5. UI specification (reference: provided mobile screenshot)

### 5.1 Layout (mobile-first, single page "Order management")
- Page background: warm off-white (`#FBFAF4`-like). Text: near-black.
- **Header row:** title `Order management` (bold, large) on the left; `Pick date` outlined button on the right.
- **Subtitle:** selected date, long format, e.g. `Saturday, November 21, 2026` (bold).
- **Orders card:** rounded white card with soft shadow.
  - Header row (grey background, uppercase small bold labels): *(checkbox column, no label)*, `NAME`, `QTY.`, `MESSAGE`.
  - One row per order: rounded-square checkbox, name, quantity, message. Rows separated by a thin divider.
  - Order of rows: `delivered = false` first, then by `placed_at` ascending; delivered rows move to the bottom, with muted text and strikethrough on name.
- **Summary (addition to reference):** below the title, `N orders · M portions · K delivered` for the selected date.
- Desktop: same layout, centered with `max-width: ~720px`.

### 5.2 Interactions
- Tapping a checkbox toggles delivered state (optimistic update, rollback + toast on failure).
- Tapping `Pick date` opens the native date input; selecting a date reloads the list. Selected date is stored in the URL (`#/?date=2026-11-21`) so it can be bookmarked/shared.
- Long `MESSAGE` text wraps to multiple lines; name wraps, never truncates silently.
- Tapping a row's text expands it (no edit in v1).
- Pull-to-refresh / a visible refresh is not required because of realtime (see 7.4).
- `Today` link/button appears when the selected date is not today.

### 5.3 States
| State | Display |
|---|---|
| Loading | skeleton rows |
| Empty | "No orders for this day." |
| Error | inline message + `Retry` button |
| Offline | banner "You're offline — showing last loaded data", checkbox disabled |
| Signed out | login screen (email + password) |

### 5.4 Accessibility & i18n
- Checkboxes are real `<input type="checkbox">` with accessible label `Mark {name} delivered`; min tap target 44×44 px.
- UI languages: English and Vietnamese (strings in `web/src/i18n/messages.ts`; the copy quoted in this spec is the English version). An EN/VI toggle in the footer of every screen (login included, beside Sign out when signed in) switches language instantly and is remembered on the device; first visit follows the browser language, falling back to English. `<html lang>` follows the active language.
- Data content must render Vietnamese diacritics correctly (UTF-8 end-to-end); order data (names, messages) is never translated.
- Dates formatted with `Intl.DateTimeFormat` in the active locale (`en-US` / `vi-VN`), always with `timeZone: 'Asia/Ho_Chi_Minh'`; order times stay 24h `HH:mm` in both languages.

## 6. Scenario-based requirements (situation → expected behaviour)

Format: **Given** context, **When** action, **Then** outcome.

### 6.1 Viewing orders
- **S1 – Open app, signed in.** Given I'm signed in and there are orders dated today, When I open the app, Then I see today's date and today's orders, undelivered first.
- **S2 – Open app, no orders today.** Given no orders exist for today, When I open the app, Then I see the empty state and `0 orders`.
- **S3 – Pick another date.** Given I'm viewing today, When I tap `Pick date` and choose 2026-11-21, Then the subtitle shows `Saturday, November 21, 2026` and only orders with that `delivery_date` are listed.
- **S4 – Past date.** Given I pick a past date, Then orders are shown and can still be toggled (to fix mistakes).
- **S5 – Day boundary.** Given it is 00:30 on 22 Nov in Vietnam (17:30 UTC on 21 Nov), When I open the app, Then "today" is 22 Nov (computed in `Asia/Ho_Chi_Minh`, not UTC).
- **S6 – Large day.** Given 200 orders on a date, Then all load (paged by 500 max) without horizontal scroll, and checkbox toggling stays responsive.
- **S7 – Long text.** Given a message of 500 chars or with emoji, Then it wraps inside the row and doesn't break the layout.

### 6.2 Confirming delivery
- **S8 – Mark delivered.** Given an undelivered order, When I tick its checkbox, Then it shows as delivered immediately, moves to the bottom, and `delivered_at`/`delivered_by` are saved.
- **S9 – Undo.** Given a delivered order, When I untick it, Then `delivered=false`, `delivered_at=null`, and it moves back up.
- **S10 – Network failure.** Given the request fails, Then the checkbox reverts and a toast "Couldn't update. Try again." appears.
- **S11 – Two helpers at once.** Given two staff devices open on the same date, When one marks an order delivered, Then the other device updates within ~2 s via Realtime without a reload.
- **S12 – Double tap.** Given I tap a checkbox twice quickly, Then the final state matches the last tap and only the latest request wins.

### 6.3 Authentication
- **S13 – Not signed in.** Given no session, Then I see the login form and no order data is requested.
- **S14 – Wrong credentials.** Then an error "Invalid email or password" is shown.
- **S15 – Session expiry.** Given my token expires, Then it is refreshed silently; if refresh fails I'm returned to login without losing the selected date.
- **S16 – Signed in but not staff.** Then I see "You don't have access" and RLS returns zero rows anyway.

### 6.4 Order API (other systems)
Endpoint: Supabase Edge Function `POST /functions/v1/orders` (upsert), `GET` (optional), `DELETE`/cancel (optional v1.1).

Auth: header `x-api-key: <key>`; the key is hashed and compared to `api_keys`. Revoked/unknown → `401`.

Request
```json
{
  "source": "messenger",
  "external_id": "msg-123456",
  "customer_name": "Honey",
  "quantity": 5,
  "message": "Em 5 suat nhe",
  "delivery_date": "2026-11-21",
  "placed_at": "2026-11-21T08:05:00+07:00"
}
```
`placed_at` is optional: an RFC 3339 date-time with an explicit offset, the time the customer placed the order. Omitted → the insert time on create, unchanged on update.

Response `201` (created) or `200` (updated): the stored order JSON.

- **S17 – Create.** Given a valid key and a new `(source, external_id)`, When I POST, Then a new order is created with `delivered=false` and `201` returned.
- **S18 – Update (idempotent).** Given an existing `(source, external_id)`, When I POST changed `quantity`/`message`/`delivery_date`, Then the same row is updated (no duplicate), `200` returned, and `delivered` is **not** reset.
- **S19 – Retry.** Given the same payload is sent twice, Then only one order exists.
- **S20 – No external_id.** Given `external_id` is omitted, Then a new order is always created.
- **S21 – Validation.** Missing `customer_name`, `quantity <= 0` or non-integer, bad date format, `placed_at` not a date-time with offset, or `message` > 2000 chars → `422` with `{ "error": "validation_failed", "fields": { ... } }`.
- **S22 – Bad auth.** Missing/invalid/revoked key → `401`. Wrong method → `405`.
- **S23 – Update delivered order.** Given the order is already delivered and quantity changes, Then the update is applied and `delivered` stays true (staff can see it in the list).
- **S24 – Realtime.** Given staff has that date open, When an order is created via the API, Then it appears in the list within ~2 s.
- **S25 – Rate limit.** More than 60 req/min per key → `429` (best effort).
- **S26 – CORS.** API is server-to-server; no wildcard CORS on write endpoints.

### 6.5 Deployment & operations
- **S27 – Deploy.** Given a push to `main`, Then GitHub Actions builds the Vue app and publishes to GitHub Pages; Supabase URL/anon key are injected via repository variables.
- **S28 – Refresh on sub-path.** Given the app is at `https://<user>.github.io/<repo>/`, When I refresh, Then the page loads (hash routing + correct `base`).
- **S29 – Key rotation.** Given a leaked API key, When an admin sets `revoked_at`, Then subsequent calls with it fail with `401` immediately.

## 7. Non-functional requirements
1. **Performance:** first meaningful paint < 2 s on 4G; list query < 300 ms for 500 rows.
2. **Security:** RLS on all tables; service-role key only in Edge Function secrets; API keys stored hashed; no PII in logs.
3. **Reliability:** all writes idempotent via `(source, external_id)`; DB migrations versioned in `supabase/migrations`.
4. **Realtime:** subscribe to `orders` changes filtered by the selected `delivery_date`; unsubscribe on date change.
5. **Browser support:** latest Safari iOS / Chrome Android; evergreen desktop browsers.
6. **Backups:** rely on Supabase daily backups (free tier: manual export documented in README).

### 7.1 Mobile optimization (primary use is a phone in the kitchen / on delivery)
| # | Requirement | Target / how to verify |
|---|---|---|
| M1 | **Mobile-first design:** base CSS targets 360–430 px wide; larger screens only add `max-width` centering. Reference design is 390 px wide. | Playwright screenshots at 360, 390, 430, 768, 1280 px; no horizontal scroll at any width |
| M2 | **Viewport:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; respect safe areas (`env(safe-area-inset-*)`) for notch and home bar. Use `100dvh`, not `100vh`. | Manual check on iPhone Safari with the bottom toolbar visible (as in reference) |
| M3 | **Touch targets:** checkboxes and buttons ≥ 44×44 px with ≥ 8 px spacing; the whole row's checkbox area is tappable, not only the box. | Lighthouse/axe tap-target audit passes |
| M4 | **No accidental zoom/scroll:** inputs use font-size ≥ 16 px (prevents iOS focus-zoom); `touch-action: manipulation` to remove the 300 ms tap delay; no horizontal overflow. | Manual check on iOS Safari + Android Chrome |
| M5 | **Performance on mid-range phones over 4G:** LCP < 2.5 s, INP < 200 ms, CLS < 0.1; initial JS ≤ 150 KB gzipped; no UI framework beyond Vue + Supabase client; lazy-load anything not on the main screen (login can be lazy). | Lighthouse mobile (Moto G Power / Slow 4G profile) in CI, fail the build on regression |
| M6 | **Fast repeat opens:** hashed, immutable-cached assets; show the last loaded list instantly from local cache (stale-while-revalidate), then refresh in the background. | Second open shows rows < 500 ms, even on slow network |
| M7 | **Poor/unstable networks:** requests have timeouts (10 s) and retry with backoff; checkbox toggles are optimistic; failed toggles queue and retry when back online, with a visible "pending" marker. | Playwright with throttled/offline network; scenario S10 still holds |
| M8 | **Installable PWA (nice to have, milestone 3+):** web manifest (name, icons, `display: standalone`, theme color matching the warm off-white background) and a minimal service worker caching the app shell, so it can be added to the home screen and opens without browser chrome. Must work under the `/<repo>/` sub-path. | Lighthouse PWA checks; "Add to Home Screen" works on iOS and Android |
| M9 | **Realtime that respects battery/data:** one Realtime channel filtered by the selected date; unsubscribe when the tab is hidden and re-fetch on `visibilitychange` (iOS suspends background sockets). | Reopen tab after 5 min shows fresh data |
| M10 | **Readable in bright light / dark mode:** contrast ≥ 4.5:1 (WCAG AA); body text ≥ 16 px, column labels ≥ 12 px; honour `prefers-color-scheme` and `prefers-reduced-motion`. | axe contrast audit; manual check outdoors |
| M11 | **One-handed use:** primary actions (`Pick date`, `Today`, refresh) reachable in the top 1/3 without hidden gestures; no hover-only interactions; no fixed element covering the last row (bottom padding ≥ browser toolbar height). | Manual check; last row fully visible and tappable |
| M12 | **Data/size budget:** list query selects only needed columns; payload for 100 orders < 30 KB; fonts: system font stack or one subset, `font-display: swap`; images avoided (use inline SVG icons). | Network panel / CI bundle-size check |
| M13 | **Cross-device compatibility:** iOS Safari 16+, Android Chrome (last 2 years of releases), Samsung Internet; Vietnamese diacritics render correctly with the chosen font. | Manual device matrix + Playwright WebKit/Chromium mobile emulation |

Scenarios (mobile)
- **S30 – Slow 4G cold start.** Given a throttled Slow 4G connection, When I open the live URL, Then the order list is visible within 3 s and the page is interactive without layout shift.
- **S31 – Tunnel / lost signal.** Given I'm offline, When I tick an order, Then it shows as delivered with a "pending" marker and syncs automatically when the connection returns.
- **S32 – Return to app.** Given the app was backgrounded for 10 minutes, When I switch back, Then the list refreshes and the Realtime channel reconnects without a manual reload.
- **S33 – Home screen app.** Given I add the app to my home screen, When I launch it, Then it opens full-screen with the correct icon and shows the last cached list immediately.
- **S34 – Notch + toolbar.** Given an iPhone with a notch and Safari's bottom toolbar, Then the header isn't clipped and the last row can be scrolled fully above the toolbar.

## 8. Project structure (proposed)
```
.
├── spec.md
├── README.md
├── .github/workflows/deploy.yml
├── supabase/
│   ├── config.toml
│   ├── migrations/          # orders, api_keys, RLS, triggers
│   ├── seed.sql
│   └── functions/orders/index.ts
└── web/
    ├── vite.config.ts       # base: '/<repo>/'
    └── src/
        ├── main.ts, App.vue
        ├── lib/supabase.ts, lib/date.ts
        ├── composables/useOrders.ts
        └── components/{OrderTable,OrderRow,DatePicker,LoginForm}.vue
```

## 9. Implementation plan (spec-driven)
Principle: **ship to the live URL first, then ship every milestone to it.** CI/CD is set up before any feature, so each milestone ends with a deployed, clickable GitHub Pages URL (`https://<user>.github.io/<repo>/`) that is checked before the milestone counts as done.

| # | Milestone | Covers | Done when (and live URL shows) |
|---|---|---|---|
| 0 | **Init CI/CD + blank page** | S27–S28, M1, M2, M5 (gate), M12 | Vite + Vue scaffold with an empty page (title only) is built by GitHub Actions on push to `main` and published to GitHub Pages. **Live URL loads the blank page**, survives refresh, and the workflow is green. Repo variables for the Supabase URL/anon key are defined (unused yet). **Mobile:** viewport meta + safe-area CSS in place; Lighthouse CI (mobile, Slow 4G) runs on every deploy with budgets (JS ≤ 150 KB gzipped, LCP < 2.5 s) and fails the build on regression; Playwright screenshot job at 360/390/430/768/1280 px shows no horizontal scroll. |
| 1 | Supabase schema + RLS + seed | §4, M12 | SQL tests pass; anon gets 0 rows. Migrations applied to the hosted project (CI step or documented `supabase db push`). **Live URL:** unchanged page, plus a footer/`/#/health` line showing "Supabase connected" to prove the deployed build reaches the backend. **Mobile:** health check uses a request timeout (M7) and selects only needed columns. |
| 2 | Auth + login screen | S13–S16, M3, M4, M10 | Staff can sign in/out. **Live URL shows the login screen**; after sign-in, an empty "Order management" shell. **Mobile:** login inputs ≥ 16 px (no iOS zoom), tap targets ≥ 44 px, password-manager autofill works, axe contrast audit passes, login is lazy-loaded within the JS budget. |
| 3 | Order list for today/date | S1–S7, S30, S33, S34, M1–M4, M6, M8, M10–M13 | **Live URL shows the real list** for today and a picked date, matching the reference UI at 390 px. **Mobile:** stale-while-revalidate cache shows last list < 500 ms on reopen (M6); PWA manifest + app-shell service worker so it installs to the home screen under `/<repo>/` (M8, S33); notch/toolbar check on iPhone Safari (S34); one-handed reach of `Pick date`/`Today` and last row not covered (M11); Slow 4G cold start ≤ 3 s (S30); Lighthouse mobile ≥ 90; manual device matrix run (M13). |
| 4 | Delivered toggle + realtime | S8–S12, S24, S31, S32, M7, M9 | Two-device test passes **on the live URL**. **Mobile:** offline tick shows "pending" marker and syncs on reconnect (S31); backgrounded-tab return refreshes and reconnects Realtime (S32, M9); Playwright run with throttled/offline network; toggle tap has no 300 ms delay and gives instant feedback. |
| 5 | Order API Edge Function | S17–S23, S25–S26, S29, M5, M12 | Edge Function deployed by CI; contract tests pass; a `curl` against the production API makes an order appear on the live URL within 2 s. **Mobile:** regression run of Lighthouse mobile and bundle/payload budgets (100 orders < 30 KB) after the API/realtime changes; final full device-matrix pass (M13) and acceptance sign-off. |

Per-milestone release checklist (applies to 0–5):
1. Merge to `main` → GitHub Actions runs lint, unit tests, build, deploy.
2. Workflow summary prints the live URL; open it on a phone and desktop.
3. Smoke test the scenarios the milestone covers against the live URL (Playwright e2e against the deployed URL where practical).
   - Run Lighthouse mobile against the live URL; scores must stay ≥ 90 and budgets (M5, M12) must hold.
   - Open the live URL on a real phone (iOS Safari and Android Chrome, over mobile data, not Wi-Fi) and check the milestone's mobile items.
4. Record the URL and a screenshot in the PR/README milestone log before starting the next milestone.
5. If the deploy fails or the smoke test breaks, fix or revert before moving on.

CI/CD details (milestone 0, extended as needed)
- Workflow `.github/workflows/deploy.yml`: trigger on push to `main` + manual `workflow_dispatch`; jobs `build` (install, lint, test, `vite build`) and `deploy` (`actions/upload-pages-artifact` + `actions/deploy-pages`); permissions `pages: write`, `id-token: write`.
- Repo Settings → Pages → Source: **GitHub Actions**.
- Build-time env from repo variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Service-role key and Edge Function secrets are never exposed to the build (added as Actions secrets only when milestone 5 deploys functions).
- Vite `base: '/<repo>/'` and hash routing set from day one.

## 10. Acceptance checklist
- [ ] Live GitHub Pages URL exists from milestone 0 and is updated and verified after every milestone.
- [ ] UI visually matches the reference screenshot on a 390 px-wide viewport.
- [ ] Lighthouse mobile scores ≥ 90 (Performance, Accessibility, Best Practices) on the live URL, and requirements M1–M13 are met.
- [ ] Every scenario S1–S34 has at least one automated test (unit, SQL, or e2e).
- [ ] No secret other than the anon key is present in the built bundle.
- [ ] Creating an order via `curl` makes it appear on an open phone within 2 s.

## 11. Open questions
1. Which systems will call the API first, and what identifier do they have (for `external_id`)?
2. Should staff be able to add/edit/cancel orders in the UI, or API-only in v1?
3. Is delivery time-of-day or address needed (affects columns and sorting)?
4. Single shared staff account or one per helper (affects `delivered_by`)?
