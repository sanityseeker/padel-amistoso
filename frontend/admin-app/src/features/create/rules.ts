import { t as tx } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';

export type TournamentKind = 'group_playoff' | 'mexicano' | 'playoff';
export type EntryMode = 'individual' | 'team';
export type Sport = 'padel' | 'tennis';

export interface Team {
  /** Stable React key. */
  id: number;
  members: string[];
  /** Optional display name; the label falls back to the members joined with " & ". */
  name: string;
}

export interface EntryRules {
  /** The Individual / Team switch is shown. */
  choice: boolean;
  /** Teams are composed one by one (the team builder) instead of typing one name per line. */
  builder: boolean;
  /** The `team_mode` flag sent to the API. */
  teamMode: boolean;
}

// Entry mode and the API's `team_mode` do not line up one to one; the legacy form fixed these rules and
// the backend validates them (a padel play-off needs team_mode; padel Mexicano needs 4 individuals unless
// team_mode). Tennis flips the Mexicano meaning: "Team" there is the dynamic 2 v 2 pairing.
//   Group + Play-off   padel: Team = fixed teams, Individual = dynamic pairs;  tennis: always team_mode.
//   Mexicano           padel: Team = fixed teams;  tennis: Individual = 1 v 1 (team_mode), Team = 2 v 2.
//   Play-offs          padel: always teams;  tennis: Individual = singles, Team = pairs.
export function entryRules(
  kind: TournamentKind,
  sport: Sport,
  entry: EntryMode,
  convert: boolean,
): EntryRules {
  const team = entry === 'team';
  if (kind === 'group_playoff')
    return { choice: true, builder: team, teamMode: sport === 'tennis' ? true : team };
  if (kind === 'mexicano') {
    if (sport === 'tennis')
      // The builder is for composing fixed teams; tennis "Team" is dynamic pairing of individuals.
      // A lobby conversion is the exception: it forms the teams from the registrants.
      return { choice: true, builder: convert && team, teamMode: convert ? true : !team };
    return { choice: true, builder: team, teamMode: team };
  }
  if (sport === 'tennis') return { choice: true, builder: team, teamMode: team };
  return { choice: false, builder: true, teamMode: true };
}

export const defaultEntry = (kind: TournamentKind, sport: Sport): EntryMode =>
  kind === 'playoff' && sport === 'padel' ? 'team' : 'individual';

export const clean = (value: string) => value.trim();
export const teamLabel = (team: Team) =>
  clean(team.name) || team.members.map(clean).filter(Boolean).join(' & ');
export const filledTeams = (teams: Team[]) =>
  teams.filter((team) => team.members.some((m) => clean(m)));
export const teamMembers = (team: Team) => team.members.map(clean).filter(Boolean);
export const uniquePlayers = (teams: Team[]) => [
  ...new Set(filledTeams(teams).flatMap((team) => teamMembers(team))),
];

let teamSeq = 0;
export const newTeam = (members: string[] = ['', '']): Team => ({
  id: ++teamSeq,
  members,
  name: '',
});

export const defaultGroupName = (index: number) => String.fromCharCode(65 + (index % 26));

/** Split into groups: snake-draft when strengths are known, otherwise shuffle and deal. */
export interface GroupDraw {
  name: string;
  players: string[];
}
export function drawGroups(
  names: string[],
  groupNames: string[],
  strengths?: Record<string, number> | null,
): GroupDraw[] {
  const count = Math.max(1, groupNames.length);
  const rated = !!strengths && Object.keys(strengths).length > 0;
  const order = [...names];
  if (rated) order.sort((a, b) => (strengths![b] ?? 0) - (strengths![a] ?? 0));
  else
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
  const buckets: string[][] = Array.from({ length: count }, () => []);
  if (rated) {
    let at = 0;
    let dir = 1;
    for (const player of order) {
      buckets[at]!.push(player);
      const next = at + dir;
      if (next >= count || next < 0) dir *= -1;
      else at = next;
    }
  } else order.forEach((player, i) => buckets[i % count]!.push(player));
  return buckets.map((players, i) => ({
    name: clean(groupNames[i] ?? '') || defaultGroupName(i),
    players,
  }));
}

/** Round-robin match count of one group: pairs for fixed sides, quads for dynamic doubles. */
export const groupMatches = (size: number, fixedSides: boolean) =>
  fixedSides ? Math.floor((size * (size - 1)) / 2) : Math.ceil((size * (size - 1)) / 4);

const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

export type BracketFormat = 'single' | 'double' | 'espejo';

/** "Number of winners" choices for a single-elimination bracket of `n` teams. */
export function winnerOptions(n: number): { value: number; label: string }[] {
  if (n < 2) return [{ value: 1, label: tx('1 — Champion (Final)') }];
  const half = Math.max(1, nextPowerOfTwo(n) / 2);
  const out: { value: number; label: string }[] = [];
  for (let k = 1; k <= half; k *= 2)
    out.push({
      value: k,
      label:
        k === 1
          ? tx('1 — Champion (Final)')
          : k === 2
            ? tx('{n} — after Semi-Finals', { n: k })
            : k === 4
              ? tx('{n} — after Quarter-Finals', { n: k })
              : tx('{n} — after {stage}', { n: k, stage: formatRoundLabel(`Round of ${k * 2}`) }),
    });
  if (n >= 4) out.push({ value: 3, label: tx('3 — Semi-Finals + 3rd-place match') });
  return out.sort((a, b) => a.value - b.value);
}

/** Total matches of a play-off bracket of `n` teams (the same estimate the legacy form showed). */
export function bracketMatches(
  n: number,
  format: BracketFormat,
  winners: number,
  thirdPlace: boolean,
): number {
  if (n < 2) return 0;
  const third = thirdPlace && n >= 4 ? 1 : 0;
  if (format === 'double') return 2 * (n - 1);
  if (format === 'espejo') return n - 1 + Math.max(0, n - nextPowerOfTwo(n) / 2 - 1) + third;
  // Single elimination: fewer winners cut the last rounds (N - 1 matches; 3 winners drop only the final).
  const removed = winners === 3 ? 1 : Math.max(0, winners - 1);
  return n - 1 - removed + third;
}

/** Matches played at the same time, round by round, in a single-elimination bracket of `n` teams. */
export function singleSequence(n: number, winners = 1, thirdPlace = false): number[] {
  if (n < 2) return [];
  const p = nextPowerOfTwo(n);
  let seq: number[] = [];
  const first = n - p / 2;
  if (first > 0) seq.push(first);
  for (let r = p / 4; r >= 1; r = Math.floor(r / 2)) seq.push(r);
  const cut = winners === 3 ? 1 : Math.round(Math.log2(Math.max(1, winners)));
  if (cut > 0 && seq.length > cut) seq = seq.slice(0, seq.length - cut);
  if (thirdPlace && n >= 4) {
    if (winners === 3) seq.push(1);
    else seq[seq.length - 1] = (seq[seq.length - 1] ?? 0) + 1;
  }
  return seq;
}

/** Winners and losers bracket of a double-elimination bracket, as matches per round. */
export function doubleSequences(n: number): { wb: number[]; lb: number[] } {
  if (n < 2) return { wb: [1], lb: [] };
  const wb = singleSequence(n);
  const during: number[] = [];
  let teams = wb[0] ?? 0;
  for (let k = 1; k < wb.length; k++) {
    const matches = Math.floor(teams / 2);
    during.push(matches);
    teams = teams - matches + wb[k]!;
  }
  const after: number[] = [];
  while (teams > 1) {
    const matches = Math.floor(teams / 2);
    after.push(matches);
    teams -= matches;
  }
  return { wb, lb: [...during, ...after] };
}

/** Mirror (Espejo): all teams play a bracket, the first-round losers play a second one. */
export function espejoSequences(n: number, thirdPlace = false): { wb: number[]; lb: number[] } {
  const losers = n - nextPowerOfTwo(n) / 2;
  return {
    wb: singleSequence(n, 1, thirdPlace),
    lb: losers >= 2 ? singleSequence(losers) : [],
  };
}

/** "4/round" when every round is the same size, else "4 → 2 → 1". */
export const sequenceText = (seq: number[]) =>
  !seq.length ? '' : seq.every((v) => v === seq[0]) ? `${seq[0]}/round` : seq.join(' → ');

const KIND_LABELS: Record<TournamentKind | 'lobby', string> = {
  group_playoff: 'GP',
  mexicano: 'Mexicano',
  playoff: 'Playoffs',
  lobby: 'Lobby',
};

/** The suggested name of a new event: club, sport, format and today's date (as the legacy form did). */
export function defaultTitle(
  kind: TournamentKind | 'lobby',
  sport: string,
  clubName?: string | null,
  entry?: EntryMode | null,
): string {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const entryLabel = entry === 'team' ? 'Teams' : entry === 'individual' ? 'Individual' : null;
  return [clubName, sport === 'tennis' ? 'Tennis' : 'Padel', KIND_LABELS[kind], entryLabel, date]
    .filter(Boolean)
    .join(' · ');
}
