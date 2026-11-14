import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  Button,
  Fieldset,
  Group,
  Input,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useOverview } from '../../components';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api, write } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail } from '../../types';
import { ActionBar, ActionBarSpacer, MutationError, StatTile } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import {
  MEXICANO_DEFAULTS,
  MexicanoOptionFields,
  type MexicanoOptions,
} from '../mexicano/MexicanoOptions';
import { ConvertPlayers } from './ConvertPlayers';
import classes from './Create.module.css';
import { GroupDraw } from './GroupDraw';
import { NameListField } from './NameListField';
import {
  CourtPreferencesFields,
  cleanPreferences,
  espejoScopes,
  type CourtPreferences,
} from './CourtPreferencesFields';
import { PlayerDetails, PlayersFields, type PlayerMeta } from './PlayersFields';
import {
  effectiveChoice,
  PLAYOFF_DEFAULTS,
  PlayoffOptions,
  type PlayoffChoice,
} from './PlayoffOptions';
import { PlayoffPreview } from './PlayoffPreview';
import { ScopeFields } from './ScopeFields';
import { TeamBuilder } from './TeamBuilder';
import {
  bracketMatches,
  clean,
  defaultEntry,
  defaultGroupName,
  entryRules,
  filledTeams,
  groupMatches,
  groupRoundMatches,
  groupSizes,
  newTeam,
  teamLabel,
  teamMembers,
  uniquePlayers,
  defaultTitle,
  type EntryMode,
  type GroupDraw as Draw,
  type Sport,
  type Team,
  type TournamentKind,
} from './rules';
import { Notice } from '../../ui/Notice';

export type { TournamentKind } from './rules';

const lines = (value: string) =>
  value
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
const unique = (names: string[]) => [...new Set(names.map(clean).filter(Boolean))];
const initialTeams = () => [newTeam(), newTeam()];

// Create a tournament, or (with `lobby`) turn a registration lobby into one. Entries are typed one per
// line or built team by team; the roster picker adds known players; for a lobby the registrants are
// ticked off instead. The Individual / Team switch and the `team_mode` flag follow rules.ts.
export function TournamentForm({ kind, lobby }: { kind: TournamentKind; lobby?: LobbyDetail }) {
  useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  // Below 62em the summary is a row of tiles above the bar and the submit sits in the action bar.
  const compact = !!useMediaQuery('(max-width: 61.99em)', false, {
    getInitialValueInEffect: false,
  });
  const [name, setName] = useState('');
  const [sport, setSport] = useState<Sport>((lobby?.sport as Sport) ?? 'padel');
  const [entry, setEntry] = useState<EntryMode | null>(null);
  const [text, setText] = useState('');
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [meta, setMeta] = useState<Record<string, PlayerMeta>>({});
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (!lobby) return new Set();
    const eligible = lobby.participant_filter?.length ? new Set(lobby.eligible_player_ids) : null;
    const taken = new Set(lobby.assigned_player_ids ?? []);
    return new Set(
      lobby.registrants
        .filter((r) => (eligible ? eligible.has(r.player_id) : !taken.has(r.player_id)))
        .map((r) => r.player_id),
    );
  });
  const [extras, setExtras] = useState<string[]>([]);
  const [courts, setCourts] = useState('Court 1\nCourt 2');
  const [assignCourts, setAssignCourts] = useState(true);
  const [perScopeCourts, setPerScopeCourts] = useState(false);
  const [courtPrefs, setCourtPrefs] = useState<CourtPreferences>({});
  const [rolling, setRolling] = useState(false);
  const [rounds, setRounds] = useState<number | string>(6);
  const [points, setPoints] = useState<number | string>(32);
  const [mex, setMex] = useState<MexicanoOptions>(MEXICANO_DEFAULTS);
  const [groups, setGroups] = useState<number | string>(2);
  const [groupLabels, setGroupLabels] = useState<string[]>([]);
  const [draw, setDraw] = useState<{ sig: string; groups: Draw[] } | null>(null);
  const [community, setCommunity] = useState(user?.default_community_id || 'open');
  const [club, setClub] = useState<string | null>(null);
  const { clubs } = useOverview();
  const [season, setSeason] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(true);
  const [playoff, setPlayoff] = useState<PlayoffChoice>(PLAYOFF_DEFAULTS);
  const [notify, setNotify] = useState(true);
  const emailStatus = useQuery({
    queryKey: ['admin', 'email-status'],
    queryFn: () => api<{ configured: boolean }>('/tournaments/email-status'),
    staleTime: 5 * 60_000,
    enabled: !!lobby,
  });

  const mode: EntryMode = entry ?? defaultEntry(kind, sport);
  const rules = entryRules(kind, sport, mode, !!lobby);
  // The name starts as club + sport + format (+ Individual / Teams where it is a choice) + date and
  // follows those choices until it is edited.
  const suggested = defaultTitle(
    kind,
    sport,
    clubs.data?.find((c) => c.id === club)?.name,
    rules.choice ? mode : null,
  );
  const lastSuggested = useRef('');
  useEffect(() => {
    if (lobby) return;
    const previous = lastSuggested.current;
    lastSuggested.current = suggested;
    setName((current) => (!current || current === previous ? suggested : current));
  }, [suggested, lobby]);
  const selectedNames = lobby
    ? lobby.registrants.filter((r) => selected.has(r.player_id)).map((r) => r.player_name)
    : [];
  const extraNames = unique(extras).filter((n) => !selectedNames.includes(n));
  const typed = lines(text);
  // Everyone who plays, by name; and the entries the format counts (teams or people).
  const people = lobby
    ? [...selectedNames, ...(rules.builder ? [] : extraNames)]
    : rules.builder
      ? uniquePlayers(teams)
      : typed;
  const builtTeams = filledTeams(teams);
  const entries = rules.builder ? builtTeams.map(teamLabel) : people;
  const courtNames = lines(courts);
  const groupCount = Math.max(1, Number(groups) || 1);
  const groupNames = Array.from(
    { length: groupCount },
    (_, i) => clean(groupLabels[i] ?? '') || defaultGroupName(i),
  );
  const strengths = (() => {
    const out: Record<string, number> = {};
    for (const n of people) {
      const v = meta[n]?.strength;
      if (v !== undefined && Number.isFinite(v)) out[n] = v;
    }
    return Object.keys(out).length ? out : null;
  })();
  // The draw works on entries. With fixed teams an entry's strength is the sum of its members' (as the
  // backend seeds it); keyed by person it would never match the team labels and the draw stayed unseeded.
  const entryStrengths = (() => {
    if (!strengths || !rules.builder) return strengths;
    const out: Record<string, number> = {};
    for (const team of builtTeams)
      out[teamLabel(team)] = teamMembers(team).reduce((sum, m) => sum + (strengths[m] ?? 0), 0);
    return out;
  })();
  const drawSig = JSON.stringify([entries, groupNames, entryStrengths]);
  const activeDraw = draw && draw.sig === drawSig ? draw.groups : null;
  const minPlayers = rules.teamMode ? 2 : 4;
  const poChoice = effectiveChoice(playoff, entries.length);
  // Preferred courts: per group (Group+Playoff) or per Espejo bracket (direct play-offs).
  const courtScopes =
    kind === 'group_playoff'
      ? groupNames.map((g) => ({ key: g, label: tx('Group {name}', { name: g }) }))
      : kind === 'playoff' && poChoice.format === 'espejo'
        ? espejoScopes()
        : [];
  const scopedCourts =
    assignCourts && perScopeCourts ? cleanPreferences(courtPrefs, courtScopes, courtNames) : {};

  const create = useAdminMutation({
    request: async () => {
      if (entries.length < (kind === 'mexicano' ? minPlayers : 2))
        throw new Error(
          kind === 'mexicano' && !rules.teamMode
            ? 'Add enough players: at least four for padel doubles or two for singles.'
            : 'Add at least two players or teams.',
        );
      if (new Set(entries.map((n) => n.toLowerCase())).size !== entries.length)
        throw new Error('Player names must be unique.');
      if (rules.builder && builtTeams.some((team) => !teamMembers(team).length))
        throw new Error('Each team needs at least one player.');
      if (assignCourts && !courtNames.length) throw new Error('Add at least one court.');
      if (kind === 'group_playoff' && !rules.teamMode) {
        const smallest = activeDraw
          ? Math.min(...activeDraw.map((g) => g.players.length))
          : Math.floor(entries.length / groupCount);
        if (smallest < 4)
          throw new Error(
            tx(
              'Individual mode needs at least 4 players per group ({min} total for {g} groups, but only {n} selected)',
              { min: 4 * groupCount, g: groupCount, n: entries.length },
            ),
          );
      }
      const pick = <T,>(get: (m: PlayerMeta) => T | undefined | '') => {
        const out: Record<string, T> = {};
        for (const n of people) {
          const v = meta[n] ? get(meta[n]!) : undefined;
          if (v !== undefined && v !== '') out[n] = v as T;
        }
        return Object.keys(out).length ? out : undefined;
      };
      const teamBody = rules.builder
        ? { teams: builtTeams.map(teamMembers), team_names: builtTeams.map((t) => clean(t.name)) }
        : {};
      const specific =
        kind === 'mexicano'
          ? {
              num_rounds: rolling ? 0 : Number(rounds),
              total_points_per_match: Number(points),
              ...mex,
              skill_gap: mex.skill_gap === '' ? null : Number(mex.skill_gap),
            }
          : kind === 'group_playoff'
            ? {
                num_groups: groupCount,
                group_names: groupNames,
                group_courts: scopedCourts,
                ...(activeDraw
                  ? {
                      group_assignments: Object.fromEntries(
                        activeDraw.map((g) => [g.name, g.players]),
                      ),
                    }
                  : {}),
              }
            : {
                double_elimination: poChoice.format === 'double',
                espejo: poChoice.format === 'espejo',
                ...(poChoice.format === 'espejo' ? { bracket_courts: scopedCourts } : {}),
                num_winners: poChoice.winners,
                third_place: poChoice.thirdPlace,
              };
      const common = {
        sport,
        court_names: assignCourts ? courtNames : [],
        assign_courts: assignCourts,
        public: isPublic,
        team_mode: rules.teamMode,
        player_strengths: pick((m) => m.strength),
        ...teamBody,
        ...specific,
      };
      if (lobby) {
        const result = await write<{ tournament_id: string; overlapping_players?: string[] }>(
          `/registrations/${lobby.id}/convert`,
          {
            ...common,
            tournament_type: kind,
            name: name.trim() || undefined,
            player_names: [
              ...selectedNames,
              ...(rules.builder ? [] : extraNames),
              ...(rules.builder
                ? uniquePlayers(teams).filter((n) => !selectedNames.includes(n))
                : []),
            ],
          },
        );
        if (result.overlapping_players?.length)
          notifications.show({
            color: 'yellow',
            message: tx('Note: {names} was already in a previous tournament from this lobby.', {
              names: result.overlapping_players.join(', '),
            }),
          });
        if (notify && emailStatus.data?.configured)
          try {
            const sent = await write<{ sent?: number; skipped?: number }>(
              `/tournaments/${result.tournament_id}/notify-players`,
            );
            notifications.show({
              color: 'green',
              message: tx('Sent {sent} emails ({skipped} skipped).', {
                sent: sent.sent ?? 0,
                skipped: sent.skipped ?? 0,
              }),
            });
          } catch (e) {
            notifications.show({ color: 'red', message: tx((e as Error).message) });
          }
        return result.tournament_id;
      }
      const result = await write<{ id: string }>(
        `/tournaments/${kind === 'group_playoff' ? 'group-playoff' : kind}`,
        {
          ...common,
          name: name.trim(),
          community_id: community,
          club_id: club,
          season_id: season,
          ...(kind === 'playoff' ? { participant_names: people } : { player_names: people }),
          player_emails: pick((m) => m.email),
          player_contacts: pick((m) => m.contact),
          player_profile_ids: pick((m) => m.profile_id),
        },
      );
      return result.id;
    },
    invalidate: [
      ['admin', 'tournaments'],
      ['admin', 'lobbies'],
      ['admin', 'lobby'],
    ],
    onSuccess: (id) => {
      notifications.show({ message: tx('Tournament created'), color: 'green' });
      navigate(`/admin/t/${id}`);
    },
  });

  const summary = useMemo(() => {
    if (kind === 'mexicano')
      return [
        {
          label: tx('Matches per round'),
          value: rules.teamMode ? Math.floor(entries.length / 2) : Math.floor(entries.length / 4),
        },
        { label: tx('Rounds'), value: rolling ? tx('Rolling') : Number(rounds) || 0 },
      ];
    if (kind === 'group_playoff') {
      const sizes = activeDraw
        ? activeDraw.map((g) => g.players.length)
        : groupSizes(entries.length, groupCount);
      const sum = (f: (size: number) => number) => sizes.reduce((acc, size) => acc + f(size), 0);
      return [
        { label: tx('Groups'), value: groupCount },
        rules.teamMode
          ? { label: tx('Group matches'), value: sum(groupMatches) }
          : { label: tx('Group matches per round'), value: sum(groupRoundMatches) },
      ];
    }
    return [
      {
        label: tx('Bracket matches'),
        value: bracketMatches(
          entries.length,
          poChoice.format,
          poChoice.winners,
          poChoice.thirdPlace,
        ),
      },
    ];
  }, [
    kind,
    entries.length,
    rolling,
    rounds,
    groupCount,
    rules.teamMode,
    activeDraw,
    poChoice.format,
    poChoice.winners,
    poChoice.thirdPlace,
  ]);

  // Read-only next to the Groups field: how many entries each group gets with this count.
  const perGroupSizes =
    kind === 'group_playoff'
      ? activeDraw
        ? activeDraw.map((g) => g.players.length)
        : groupSizes(entries.length, groupCount)
      : [];
  const perGroupMin = perGroupSizes.length ? Math.min(...perGroupSizes) : 0;
  const perGroupMax = perGroupSizes.length ? Math.max(...perGroupSizes) : 0;
  const perGroup = perGroupMin === perGroupMax ? perGroupMin : `${perGroupMin}–${perGroupMax}`;
  const tiles = (
    <>
      <StatTile label={rules.builder ? tx('Teams') : tx('Players')} value={entries.length} />
      <StatTile label={tx('Courts')} value={assignCourts ? courtNames.length : 0} />
      {summary.map((s) => (
        <StatTile key={s.label} label={s.label} value={s.value} />
      ))}
    </>
  );
  const minWarning = entries.length > 0 && entries.length < minPlayers && kind === 'mexicano' && (
    <Text size="xs" c="red">
      {tx('Add at least {n} players.', { n: minPlayers })}
    </Text>
  );
  const submit = (
    <Button
      type="submit"
      size={compact ? 'touch' : 'md'}
      fullWidth
      loading={create.isPending}
      form="tournament-form"
    >
      {lobby ? tx('Convert to tournament') : tx('Create tournament')}
    </Button>
  );

  return (
    <form
      id="tournament-form"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className={classes.layout}>
        <Stack gap="lg">
          <MutationError error={create.error} />
          <Fieldset legend={tx('Basics')}>
            <Stack>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label={tx('Tournament name')}
                  placeholder={lobby?.name ?? tx('Friday night padel')}
                  required={!lobby}
                  maxLength={255}
                  value={name}
                  onChange={(e) => setName(e.currentTarget.value)}
                />
                <Input.Wrapper label={tx('Sport')}>
                  <SegmentedControl
                    fullWidth
                    mt={4}
                    aria-label={tx('Sport')}
                    disabled={!!lobby}
                    data={[
                      { value: 'padel', label: tx('Padel') },
                      { value: 'tennis', label: tx('Tennis') },
                    ]}
                    value={sport}
                    onChange={(v) => setSport(v === 'tennis' ? 'tennis' : 'padel')}
                  />
                </Input.Wrapper>
              </SimpleGrid>
              {!lobby && (
                <ScopeFields
                  community={community}
                  setCommunity={setCommunity}
                  club={club}
                  setClub={setClub}
                  season={season}
                  setSeason={setSeason}
                />
              )}
            </Stack>
          </Fieldset>
          <Fieldset legend={lobby ? tx('Players from the lobby') : tx('Players')}>
            {lobby ? (
              <Stack>
                {rules.choice && (
                  <SegmentedControl
                    aria-label={tx('Entries')}
                    value={mode}
                    onChange={(v) => setEntry(v as EntryMode)}
                    data={[
                      { value: 'individual', label: tx('Individual') },
                      { value: 'team', label: tx('Team') },
                    ]}
                  />
                )}
                <ConvertPlayers
                  lobby={lobby}
                  selected={selected}
                  onSelected={setSelected}
                  extras={extras}
                  onExtras={setExtras}
                  showExtras={!rules.builder}
                />
                {rules.builder && (
                  <TeamBuilder teams={teams} onChange={setTeams} pool={selectedNames} />
                )}
                <PlayerDetails names={people} meta={meta} onMeta={setMeta} strengthOnly />
              </Stack>
            ) : (
              <PlayersFields
                choice={rules.choice}
                entry={mode}
                onEntry={setEntry}
                builder={rules.builder}
                text={text}
                onText={setText}
                teams={teams}
                onTeams={setTeams}
                playerNames={people}
                meta={meta}
                onMeta={setMeta}
                count={entries.length}
                sport={sport}
                clubId={club}
                hint={
                  rules.teamMode
                    ? tx('One name per line. Each line plays as one side.')
                    : tx(
                        'One name per line. Individual entries; doubles are paired by the tournament engine.',
                      )
                }
              />
            )}
          </Fieldset>
          <Fieldset legend={tx('Courts and scoring')}>
            <Stack>
              <Switch
                label={tx('Assign courts')}
                description={tx('Off: matches are not given a court.')}
                checked={assignCourts}
                onChange={(e) => setAssignCourts(e.currentTarget.checked)}
              />
              {assignCourts && (
                <NameListField
                  label={tx('Courts')}
                  description={tx('One court per line')}
                  minRows={2}
                  value={courts}
                  onChange={setCourts}
                  itemLabel={(n) => tx('Court {n}', { n })}
                  itemPlaceholder={(n) => tx('Court {n}', { n })}
                  removeLabel={(n) => tx('Remove court {n}', { n })}
                  addLabel={tx('Add court')}
                />
              )}
              {assignCourts && (
                <CourtPreferencesFields
                  enabled={perScopeCourts}
                  onEnabledChange={setPerScopeCourts}
                  scopes={courtScopes}
                  courtNames={courtNames}
                  value={courtPrefs}
                  onChange={setCourtPrefs}
                />
              )}
              {kind === 'mexicano' && (
                <Stack gap="sm">
                  <SimpleGrid cols={2}>
                    <NumberInput
                      label={tx('Rounds')}
                      min={1}
                      max={100}
                      allowDecimal={false}
                      required={!rolling}
                      disabled={rolling}
                      value={rounds}
                      onChange={setRounds}
                    />
                    <NumberInput
                      label={tx('Points per match')}
                      min={1}
                      max={1000}
                      allowDecimal={false}
                      required
                      value={points}
                      onChange={setPoints}
                    />
                  </SimpleGrid>
                  <Switch
                    label={tx('Rolling rounds')}
                    description={tx('No fixed number: play rounds until you end them.')}
                    checked={rolling}
                    onChange={(e) => setRolling(e.currentTarget.checked)}
                  />
                  <Accordion variant="contained" radius="lg">
                    <Accordion.Item value="advanced">
                      <Accordion.Control>{tx('Advanced settings')}</Accordion.Control>
                      <Accordion.Panel>
                        <MexicanoOptionFields
                          value={mex}
                          onChange={setMex}
                          fixedTeams={rules.teamMode}
                        />
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                </Stack>
              )}
              {kind === 'group_playoff' && (
                <Stack gap="sm">
                  <SimpleGrid cols={2} spacing="sm">
                    <NumberInput
                      label={tx('Groups')}
                      min={1}
                      max={32}
                      allowDecimal={false}
                      required
                      value={groups}
                      onChange={setGroups}
                    />
                    <StatTile label={tx('Group sizes')} value={perGroup} />
                  </SimpleGrid>
                  <Accordion variant="contained" radius="lg">
                    <Accordion.Item value="groups">
                      <Accordion.Control>{tx('Group names and draw')}</Accordion.Control>
                      <Accordion.Panel>
                        <Stack gap="md">
                          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                            {groupNames.map((_, i) => (
                              <TextInput
                                key={i}
                                aria-label={tx('Group {n} name', { n: i + 1 })}
                                placeholder={defaultGroupName(i)}
                                value={groupLabels[i] ?? ''}
                                onChange={(e) => {
                                  const next = [...groupLabels];
                                  next[i] = e.currentTarget.value;
                                  setGroupLabels(next);
                                }}
                              />
                            ))}
                          </SimpleGrid>
                          <GroupDraw
                            names={entries}
                            groupNames={groupNames}
                            strengths={entryStrengths}
                            fixedSides={rules.teamMode}
                            value={activeDraw}
                            onChange={(next) =>
                              setDraw(next ? { sig: drawSig, groups: next } : null)
                            }
                          />
                        </Stack>
                      </Accordion.Panel>
                    </Accordion.Item>
                  </Accordion>
                </Stack>
              )}
              {kind === 'playoff' && (
                <Stack gap="sm">
                  <PlayoffOptions
                    value={playoff}
                    onChange={setPlayoff}
                    teams={entries.length}
                    allowEspejo={!lobby}
                  />
                  <Group>
                    <PlayoffPreview
                      names={entries}
                      format={poChoice.format}
                      winners={poChoice.winners}
                      thirdPlace={poChoice.thirdPlace}
                      title={name}
                    />
                  </Group>
                </Stack>
              )}
            </Stack>
          </Fieldset>
          <Fieldset legend={tx('Visibility')}>
            <Stack>
              <Switch
                label={tx('List publicly')}
                checked={isPublic}
                onChange={(e) => setPublic(e.currentTarget.checked)}
              />
              {lobby && emailStatus.data?.configured && (
                <Switch
                  label={tx('Email the players when the tournament is created')}
                  checked={notify}
                  onChange={(e) => setNotify(e.currentTarget.checked)}
                />
              )}
            </Stack>
          </Fieldset>
          {lobby && selected.size === 0 && (
            <Notice tone="warning">{tx('Select at least two registrants to convert.')}</Notice>
          )}
        </Stack>
        {compact ? (
          <>
            {!phone && (
              <Paper p="md" aria-label={tx('Summary')}>
                <SimpleGrid cols={4} spacing="sm">
                  {tiles}
                </SimpleGrid>
                {minWarning}
              </Paper>
            )}
            <ActionBarSpacer />
            <ActionBar>{submit}</ActionBar>
          </>
        ) : (
          <Paper p="md" className={classes.summary} aria-label={tx('Summary')}>
            <Stack gap="md">
              <Text variant="eyebrow">{tx('Summary')}</Text>
              {tiles}
              {minWarning}
              {submit}
            </Stack>
          </Paper>
        )}
      </div>
    </form>
  );
}
