#!/usr/bin/env node
/**
 * Logic test for the club admin Events card row derivation
 * (`deriveEventRows` in frontend/admin-utils.js). No DOM, no server: the
 * function block is extracted from the source between its BEGIN/END markers
 * and evaluated under node.
 *
 * Run: node scripts/verify_club_events_logic.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'frontend', 'admin-utils.js'), 'utf8');
const start = src.indexOf('// BEGIN deriveEventRows');
const end = src.indexOf('// END deriveEventRows');
assert.ok(start > 0 && end > start, 'deriveEventRows markers missing in admin-utils.js');
// eslint-disable-next-line no-new-func
const deriveEventRows = new Function(`${src.slice(start, end)}\nreturn deriveEventRows;`)();
const aStart = src.indexOf('// BEGIN deriveAttachCandidates');
const aEnd = src.indexOf('// END deriveAttachCandidates');
assert.ok(aStart > 0 && aEnd > aStart, 'deriveAttachCandidates markers missing in admin-utils.js');
// eslint-disable-next-line no-new-func
const deriveAttachCandidates = new Function(`${src.slice(aStart, aEnd)}\nreturn deriveAttachCandidates;`)();

const CLUB = 'cl_1';
const OTHER = 'cl_2';
const tournament = (over) => ({
  id: 'tn_x', name: 'T', type: 'group_playoff', phase: 'groups', owner: 'alice', shared: false,
  public: true, sport: 'padel', club_id: CLUB, community_id: 'cm_1', season_id: null, created_at: '2026-01-01', ...over,
});
const lobby = (over) => ({
  id: 'rg_x', name: 'L', open: true, archived: false, listed: true, sport: 'padel', club_id: CLUB,
  community_id: 'cm_1', converted_to_tids: [], registrant_count: 0, season_id: null, created_at: '2026-01-01', ...over,
});
const opts = { clubId: CLUB, authUser: 'alice', admin: false };
const byKey = (rows) => Object.fromEntries(rows.map(r => [r.key, r]));

// 1. Filter by club_id, never by community.
{
  const rows = deriveEventRows(
    [tournament({ id: 'tn_in' }), tournament({ id: 'tn_other', club_id: OTHER }), tournament({ id: 'tn_none', club_id: null })],
    [lobby({ id: 'rg_in' }), lobby({ id: 'rg_other', club_id: OTHER })],
    opts,
  );
  assert.deepEqual(rows.map(r => r.key).sort(), ['rg:rg_in'.replace('rg:', 'reg:'), 'tn:tn_in'].sort());
}

// 2. Tournament states + tabs.
{
  const rows = byKey(deriveEventRows([
    tournament({ id: 'a', phase: 'groups' }),
    tournament({ id: 'b', phase: 'setup' }),
    tournament({ id: 'c', phase: 'finished' }),
    tournament({ id: 'd', phase: 'setup', type: 'mexicano' }),
  ], [], opts));
  assert.equal(rows['tn:a'].state, 'live');
  assert.equal(rows['tn:a'].tab, 'active');
  assert.equal(rows['tn:b'].state, 'upcoming');
  assert.equal(rows['tn:b'].tab, 'active');
  assert.equal(rows['tn:c'].state, 'finished');
  assert.equal(rows['tn:c'].tab, 'finished');
  assert.equal(rows['tn:d'].state, 'live', 'only GP has a setup phase that means "not started"');
}

// 3. canEdit: owner / shared / admin.
{
  const rows = byKey(deriveEventRows([
    tournament({ id: 'mine' }),
    tournament({ id: 'shared', owner: 'bob', shared: true }),
    tournament({ id: 'bobs', owner: 'bob' }),
  ], [], opts));
  assert.equal(rows['tn:mine'].canEdit, true);
  assert.equal(rows['tn:shared'].canEdit, true);
  assert.equal(rows['tn:bobs'].canEdit, false);
  const asAdmin = byKey(deriveEventRows([tournament({ id: 'bobs', owner: 'bob' })], [], { ...opts, admin: true }));
  assert.equal(asAdmin['tn:bobs'].canEdit, true);
}

// 4. Lobby states.
{
  const rows = byKey(deriveEventRows([], [
    lobby({ id: 'open' }),
    lobby({ id: 'ready', open: false, registrant_count: 4 }),
    lobby({ id: 'small', open: false, registrant_count: 1 }),
    lobby({ id: 'arch', open: false, archived: true, registrant_count: 4 }),
  ], opts));
  assert.equal(rows['reg:open'].state, 'open_registration');
  assert.equal(rows['reg:open'].isPublic, true);
  assert.equal(rows['reg:ready'].state, 'ready_to_convert');
  assert.equal(rows['reg:ready'].isPublic, false, 'closed lobbies are not on the club page');
  assert.equal(rows['reg:small'].state, 'closed');
  assert.equal(rows['reg:small'].tab, 'finished');
  assert.equal(rows['reg:arch'].state, 'archived');
  assert.equal(rows['reg:arch'].tab, 'archived');
  const unlisted = byKey(deriveEventRows([], [lobby({ id: 'u', listed: false })], opts));
  assert.equal(unlisted['reg:u'].isPublic, false);
}

// 5. Converted lobbies: one row per tournament, "from lobby" link, no own row.
{
  const rows = deriveEventRows(
    [tournament({ id: 't1' }), tournament({ id: 't2' })],
    [lobby({ id: 'src', name: 'Source', open: false, converted_to_tids: ['t1', 't2'], registrant_count: 8 })],
    opts,
  );
  assert.deepEqual(rows.map(r => r.key).sort(), ['tn:t1', 'tn:t2']);
  assert.deepEqual(rows[0].fromLobby, { id: 'src', name: 'Source' });
}

// 6. Partial conversion with the lobby still open keeps the lobby row.
{
  const rows = byKey(deriveEventRows(
    [tournament({ id: 't1' })],
    [lobby({ id: 'src', open: true, converted_to_tids: ['t1'], registrant_count: 8 })],
    opts,
  ));
  assert.ok(rows['reg:src'], 'open lobby keeps its row');
  assert.equal(rows['reg:src'].state, 'open_registration');
  assert.deepEqual(rows['tn:t1'].fromLobby, { id: 'src', name: 'L' });
}

// 7. Deleted converted tournament → lobby falls back to ready_to_convert / closed.
{
  const ready = byKey(deriveEventRows([], [lobby({ id: 'src', open: false, converted_to_tids: ['gone'], registrant_count: 6 })], opts));
  assert.equal(ready['reg:src'].state, 'ready_to_convert');
  const closed = byKey(deriveEventRows([], [lobby({ id: 'src', open: false, converted_to_tids: ['gone'], registrant_count: 1 })], opts));
  assert.equal(closed['reg:src'].state, 'closed');
}

// 8. Public items the user cannot edit become read-only rows; editable ones are not duplicated.
{
  const rows = byKey(deriveEventRows(
    [tournament({ id: 'mine' })],
    [],
    {
      ...opts,
      publicItems: [
        { id: 'mine', pin_key: 'tn:mine', kind: 'tournament', status: 'in_progress', name: 'T' },
        { id: 'theirs', pin_key: 'tn:theirs', kind: 'tournament', status: 'upcoming', name: 'Their cup', sport: 'tennis', type: 'playoff' },
        { id: 'rg_pub', pin_key: 'reg:rg_pub', kind: 'registration', status: 'open_registration', name: 'Open', registrant_count: 3 },
      ],
    },
  ));
  assert.equal(Object.keys(rows).length, 3);
  assert.equal(rows['tn:mine'].canEdit, true);
  assert.equal(rows['tn:theirs'].canEdit, false);
  assert.equal(rows['tn:theirs'].state, 'upcoming');
  assert.equal(rows['tn:theirs'].sport, 'tennis');
  assert.equal(rows['reg:rg_pub'].kind, 'lobby');
  assert.equal(rows['reg:rg_pub'].registrantCount, 3);
  assert.equal(rows['reg:rg_pub'].canEdit, false);
}

// 9. Garbage in → empty out.
assert.deepEqual(deriveEventRows(null, undefined, { clubId: CLUB }), []);

// ── Attach suggestions ──────────────────────────────────────────────────────
const aOpts = { clubId: CLUB, clubCommunityId: 'cm_1', authUser: 'alice', admin: false, communityName: (id) => ({ cm_1: 'Comm One', cm_2: 'Comm Two' }[id] || '') };

// 10. Only club-less events are suggested — never ones in this or another club.
{
  const out = deriveAttachCandidates(
    [tournament({ id: 'free', club_id: null }), tournament({ id: 'here' }), tournament({ id: 'other', club_id: OTHER })],
    [lobby({ id: 'lfree', club_id: null }), lobby({ id: 'lother', club_id: OTHER }), lobby({ id: 'larch', club_id: null, archived: true })],
    aOpts,
  );
  assert.deepEqual(out.candidates.map(c => c.key).sort(), ['reg:lfree', 'tn:free']);
  assert.deepEqual(out.dismissed, []);
}

// 11. Only editable tournaments; community-move hint when the community differs.
{
  const out = deriveAttachCandidates(
    [tournament({ id: 'mine', club_id: null, community_id: 'cm_2' }), tournament({ id: 'bobs', club_id: null, owner: 'bob' }), tournament({ id: 'shared', club_id: null, owner: 'bob', shared: true })],
    [], aOpts,
  );
  const keys = out.candidates.map(c => c.key).sort();
  assert.deepEqual(keys, ['tn:mine', 'tn:shared']);
  const mine = out.candidates.find(c => c.key === 'tn:mine');
  assert.equal(mine.movesCommunity, true);
  assert.equal(mine.communityName, 'Comm Two');
  assert.equal(out.candidates.find(c => c.key === 'tn:shared').movesCommunity, false);
  const asAdmin = deriveAttachCandidates([tournament({ id: 'bobs', club_id: null, owner: 'bob' })], [], { ...aOpts, admin: true });
  assert.equal(asAdmin.candidates.length, 1);
}

// 12. Dismissed keys are split out; search filters both lists; newest first.
{
  const out = deriveAttachCandidates(
    [tournament({ id: 'a', club_id: null, name: 'Alpha Cup', created_at: '2026-01-01' }), tournament({ id: 'b', club_id: null, name: 'Beta Cup', created_at: '2026-02-01' })],
    [lobby({ id: 'l', club_id: null, name: 'Gamma Lobby', created_at: '2026-03-01' })],
    { ...aOpts, dismissed: ['tn:a', 'tn:does_not_exist'] },
  );
  assert.deepEqual(out.candidates.map(c => c.key), ['reg:l', 'tn:b']);
  assert.deepEqual(out.dismissed.map(c => c.key), ['tn:a']);
  assert.equal(out.dismissed[0].dismissed, true);
  const searched = deriveAttachCandidates(
    [tournament({ id: 'a', club_id: null, name: 'Alpha Cup' }), tournament({ id: 'b', club_id: null, name: 'Beta Cup' })],
    [], { ...aOpts, query: 'beta' },
  );
  assert.deepEqual(searched.candidates.map(c => c.key), ['tn:b']);
}

// 13. Garbage in → empty out.
assert.deepEqual(deriveAttachCandidates(null, undefined, { clubId: CLUB }), { candidates: [], dismissed: [] });

console.log('verify_club_events_logic: all assertions passed');
