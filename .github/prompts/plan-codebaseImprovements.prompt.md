# Padel-Amistoso Improvement Plan

## Performance

### High Impact
1. **Pickle serialization on every mutation** — Every score, court, or setting change in `backend/api/state.py` triggers `pickle.dumps()` of the entire tournament object graph then writes it as a BLOB. A Mexicano tournament with 20+ rounds serializes a growing object on every request. Migrating to JSON with `to_dict()`/`from_dict()` methods on tournament classes (or at minimum, adding a dirty-flag so saves only happen when data actually changed) would be the biggest single performance win.

2. **Polling everywhere, no push** — TV polls every 3s, registration every 8s, admin every 30s, Player Hub every 30s. While the ETag/304 pattern is efficient, **Server-Sent Events (SSE)** would eliminate redundant requests entirely, reduce server load, and give near-instant updates. The existing version-tracking already provides the right primitives to emit events.

### Medium Impact
3. **`get_co_editors()` hits DB on every authenticated request** — `backend/api/helpers.py` calls `get_co_editors(tid)` per mutation, opening a DB connection each time. The co-editor list changes only when collaborators are added/removed. An in-memory cache with write-through invalidation would save one DB round-trip per authenticated request.

4. **Player secrets not cached** — Unlike tournaments and users (which are in-memory), player secrets are read from SQLite on every passphrase lookup, QR scan, and opponent query in `backend/api/player_secret_store.py`. Caching by tournament ID with invalidation on modification would cut latency for all player-facing auth and data access.

5. **Full TV data reload on version change** — When the TV detects a version bump, it re-fetches all status + matches + breakdowns and re-renders everything. The admin already has `_surgicalScoreUpdate` — extending this diff-based update pattern to the TV view would reduce data transfer and render time significantly.

6. **Bracket image regenerated every request** — `backend/viz/bracket_schema.py` renders PNG/SVG on every call with no caching. Caching keyed by tournament version + adding `Cache-Control` headers on the response would avoid redundant matplotlib runs.

### Low Impact
7. **DB connection PRAGMAs re-run on every `get_db()` call** — `backend/api/db.py` runs 4 PRAGMAs (WAL, foreign_keys, busy_timeout, synchronous) per connection. A per-thread connection pool would avoid this repeated setup.

8. **Registration ID allocation race condition** — `_next_registration_id()` in `backend/api/routes_registration.py` lacks the asyncio lock that tournament ID allocation has, allowing theoretical duplicate IDs under concurrent creation.

---

## Admin Flow

### High Impact
9. **Tournament duplication / templates** — Admins running weekly events re-enter courts, scoring rules, strength weights, and email settings from scratch. A "Duplicate tournament" or "Save as template" feature that copies settings without player data would be a major time-saver.

10. **ES module migration** — The 10 admin JS files still use global-scope functions with no imports/exports. Migrating to ES modules would enable lazy loading, prevent namespace collisions, improve refactorability, and unlock tree-shaking.

### Medium Impact
11. **Admin undo for score recording** — Admin scores bypass the player lifecycle via `_mark_admin_score()` in `backend/api/helpers.py`. There's no explicit "undo last score" action for typos. The `score_history` audit log already exists per match — adding an undo button that reverses the latest entry would reduce admin stress during live events.

12. **Surface persistence failures** — `_save_tournament` in `backend/api/state.py` catches all exceptions and only logs a warning. The HTTP response succeeds even when the DB write fails, causing silent data loss on restart. At minimum, return a warning flag in the API response when persistence fails.

13. **Bulk operations** — No bulk archive, bulk delete, or bulk visibility toggle exists. Admins managing many finished tournaments must act one-at-a-time. A simple multi-select + batch action would help.

14. **JSON export/import** — Tournament data is only stored as pickle BLOBs, making backups fragile across code versions. A JSON export endpoint would serve both backup and migration purposes.

### Low Impact
15. **Migration framework** — `backend/api/db.py` has ~150 lines of ad-hoc `PRAGMA table_info` + `ALTER TABLE` migration logic that grows with every schema change. A simple `schema_version` table with sequential migration scripts would make this maintainable.

16. **Split `routes_registration.py`** — At 1725 lines, this is the largest route file combining CRUD, conversion, email sending, and registrant management. Splitting into sub-modules would improve navigability.

---

## Player Flow

### High Impact
17. **Web Push Notifications** — The service worker and `manifest.json` already exist. Adding Web Push for "your match is ready", "score recorded", "new round available", and "tournament finished" would be the single biggest UX uplift for players at the venue, eliminating the need to manually refresh.

### Medium Impact
18. **Offline score viewing** — At sports venues, network is often unreliable. Caching the last known tournament state in localStorage/IndexedDB so the TV view remains readable offline (with a "last updated X min ago" indicator) would improve reliability significantly.

19. **Match timer / estimated wait** — Players see pending matches but have no indication of timing. Recording a timestamp when a match transitions to `in_progress` would enable "Match in progress for X min" and "Your match is next" indicators — the most common question players ask.

20. **Reduce auth friction for returning players** — Passphrase auth works well initially, but returning players often forget their phrase. The Player Hub profile passphrase fallback is partially implemented. Making the "Log in with Player Hub" option more prominent in the TV login view (not just registration) would reduce abandonment.

### Low Impact
21. **Mobile bracket rendering** — The TV bracket image is designed for large screens; on mobile the lightbox with zoom/pan helps, but a simplified responsive bracket view (horizontal scroll with column snap, or a text-based bracket list) would be more usable.

22. **Quick teammate notification** — Players can see opponents' contact info, but a "Notify opponent" button that sends a pre-written email via the existing SMTP system ("I'm ready at Court X") would add convenience without building full in-app messaging.

---

## Architecture / Security Quick Wins

| Finding | Impact | Effort |
|---------|--------|--------|
| Add FK constraints (`REFERENCES`, `ON DELETE CASCADE`) to `backend/api/db.py` DDL — prevents orphaned data, simplifies cleanup code | Medium | Low |
| Narrow `_RestrictedUnpickler` in `backend/api/state.py` to an explicit class allowlist instead of all `backend.*` | Medium | Low |
| Replace broad `except Exception # noqa: BLE001` (~15 occurrences) with specific `sqlite3.Error`/`pickle.UnpicklingError` — stops swallowing real bugs | Medium | Low |
| Clean up `_registration_locks` in `backend/api/routes_registration.py` on delete (currently grows unboundedly) | Low | Low |
| Add content-hash cache busting for frontend static assets served by `backend/api/__init__.py` | Low | Low |

---

## Suggested Starting Points

Best effort-to-impact ratio first:
1. **#3 + #4** — In-memory caching for co-editors and player secrets (low effort, medium impact each)
2. **#17** — Web Push Notifications (medium effort, high player-facing impact)
3. **#12** — Surface persistence failures (low effort, prevents silent data loss)
4. **#9** — Tournament duplication/templates (medium effort, high admin QoL)
