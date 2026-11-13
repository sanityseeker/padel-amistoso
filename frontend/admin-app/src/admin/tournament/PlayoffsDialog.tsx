import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { ResponsiveSheet } from '../../ui';
import classes from './Dialogs.module.css';
import { t as tx, useLocale } from '../../i18n';
import { api, write } from '../../api';
import type { RecommendedEntry } from '../../types';
import {
  bracketMatches,
  doubleSequences,
  espejoSequences,
  sequenceText,
  singleSequence,
  winnerOptions,
} from '../../features/create/rules';
import type { TournamentPrefix } from './query';
import { Notice } from '../../ui/Notice';
import { StatusBadge } from '../../ui/StatusBadge';

type Format = 'single' | 'double' | 'espejo' | 'split';
type Side = 'oro' | 'plata' | 'out';
interface External {
  id: string;
  name: string;
  score: number;
  side: 'oro' | 'plata';
}

// "Start the play-offs": the recommended seeding (GET /{gp|mex}/recommend-playoffs), a choice of who
// advances and in which format, then POST /{gp|mex}/start-playoffs. Extras: external participants
// (seeded by a score), composed teams, and for group tournaments the Gold / Silver (Oro / Plata) split.
export function PlayoffsDialog({
  tid,
  prefix,
  title,
  playerCount,
  fixedTeams = false,
  composable = true,
  onClose,
}: {
  tid: string;
  prefix: Extract<TournamentPrefix, 'gp' | 'mex'>;
  title: string;
  playerCount: number;
  /** Fixed teams (team mode): entries are already teams. */
  fixedTeams?: boolean;
  /** Offer manual team composition. */
  composable?: boolean;
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const mex = prefix === 'mex';
  const defaultCount = mex ? Math.min(4, playerCount - (playerCount % 2)) : 0;
  const [count, setCount] = useState<number | string>(mex ? defaultCount : 0);
  const [format, setFormat] = useState<Format>('single');
  const [thirdPlace, setThirdPlace] = useState(false);
  const [winners, setWinners] = useState<number | string>(1);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [externals, setExternals] = useState<External[]>([]);
  const [extName, setExtName] = useState('');
  const [extScore, setExtScore] = useState<number | string>(0);
  const [extSide, setExtSide] = useState<'oro' | 'plata'>('oro');
  const [assign, setAssign] = useState<Record<string, Side> | null>(null);
  const [plataThird, setPlataThird] = useState(false);
  const [compose, setCompose] = useState(false);
  const [teams, setTeams] = useState<string[][]>([]);

  const rec = useQuery({
    queryKey: ['admin', 'recommend', tid, prefix, mex ? count : 'all'],
    retry: false,
    gcTime: 0,
    queryFn: async (): Promise<RecommendedEntry[]> =>
      mex
        ? (
            await api<{ recommended_teams: RecommendedEntry[] }>(
              `/tournaments/${tid}/mex/recommend-playoffs?n_teams=${Number(count) || 4}`,
            )
          ).recommended_teams
        : (
            await api<{ recommended_participants: RecommendedEntry[] }>(
              `/tournaments/${tid}/gp/recommend-playoffs`,
            )
          ).recommended_participants,
  });
  const rows = rec.data ?? [];
  // Group stage: the top two of each group advance unless the organizer changes the selection.
  const initial = useMemo(
    () =>
      rows
        .filter((r) => !r.withdrawn && (mex || (r.group_rank ?? 99) <= 2))
        .map((r) => r.player_id),
    [rows, mex],
  );
  useEffect(() => {
    if (rec.data && chosen === null) setChosen(initial);
  }, [rec.data, chosen, initial]);
  const selected = chosen ?? initial;
  const split = format === 'split';
  // Default Gold / Silver split: the better half of every group plays for Gold.
  const defaultAssign = useMemo(() => {
    const out: Record<string, Side> = {};
    const byGroup = new Map<string, RecommendedEntry[]>();
    for (const r of rows) byGroup.set(r.group ?? '', [...(byGroup.get(r.group ?? '') ?? []), r]);
    for (const list of byGroup.values()) {
      const live = list
        .filter((r) => !r.withdrawn)
        .sort((a, b) => (a.group_rank ?? 0) - (b.group_rank ?? 0));
      list.filter((r) => r.withdrawn).forEach((r) => (out[r.player_id] = 'out'));
      const half = Math.ceil(live.length / 2);
      live.forEach((r, i) => (out[r.player_id] = i < half ? 'oro' : 'plata'));
    }
    return out;
  }, [rows]);
  const sides = assign ?? defaultAssign;
  const [cutoffValue, setCutoff] = useState<number | null>(null);
  const cutoff =
    cutoffValue ??
    Math.max(
      1,
      ...[...new Set(rows.map((r) => r.group ?? ''))].map((g) =>
        Math.ceil(rows.filter((r) => (r.group ?? '') === g && !r.withdrawn).length / 2),
      ),
    );
  // Places 1 to k of every group play for Gold, the rest for Silver; withdrawn players stay out.
  const applyCutoff = (k: number) => {
    setCutoff(k);
    const out: Record<string, Side> = {};
    const byGroup = new Map<string, RecommendedEntry[]>();
    for (const r of rows) byGroup.set(r.group ?? '', [...(byGroup.get(r.group ?? '') ?? []), r]);
    for (const list of byGroup.values()) {
      list.filter((r) => r.withdrawn).forEach((r) => (out[r.player_id] = 'out'));
      list
        .filter((r) => !r.withdrawn)
        .sort((a, b) => (a.group_rank ?? 0) - (b.group_rank ?? 0))
        .forEach((r, i) => (out[r.player_id] = i < k ? 'oro' : 'plata'));
    }
    setAssign(out);
  };
  const sideIds = (side: Side) =>
    rows.filter((r) => sides[r.player_id] === side).map((r) => r.player_id);
  const ordered = rows.filter((r) => selected.includes(r.player_id)).map((r) => r.player_id);
  const names = new Map(rows.map((r) => [r.player_id, r.player]));
  externals.forEach((e) => names.set(`ext_${e.id}`, e.name));
  const poolIds = [...ordered, ...externals.map((e) => `ext_${e.id}`)];

  const extraBody = externals.map((e) => ({ name: e.name, score: e.score }));
  const start = useMutation({
    mutationFn: () => {
      const composed = compose && teams.length > 0 ? teams.filter((t) => t.every(Boolean)) : null;
      if (composed && composed.length < 2) throw new Error('Compose at least two teams.');
      if (mex) {
        // Externals sit among the players by score so the adjacent-seed pairing stays fair.
        const seeded: string[] = [];
        const score = (id: string) =>
          rows.find((r) => r.player_id === id)?.total_points ??
          externals.find((e) => `ext_${e.id}` === id)?.score ??
          0;
        const base = composed ? composed.flat() : [...ordered];
        if (!composed) for (const e of externals) base.push(`ext_${e.id}`);
        seeded.push(...(composed ? base : base.sort((a, b) => score(b) - score(a))));
        return write(`/tournaments/${tid}/mex/start-playoffs`, {
          team_player_ids: seeded,
          n_teams: Math.max(2, Math.floor(seeded.length / 2)),
          double_elimination: format === 'double',
          extra_participants: externals.length
            ? externals.map((e) => ({
                name: e.name,
                score: e.score,
                placeholder_id: `ext_${e.id}`,
              }))
            : null,
          playoff_teams: composed,
        });
      }
      if (split)
        return write(`/tournaments/${tid}/gp/start-playoffs`, {
          espejo_split: true,
          oro_player_ids: sideIds('oro'),
          plata_player_ids: sideIds('plata'),
          oro_extra_participants: externals
            .filter((e) => e.side === 'oro')
            .map((e) => ({ name: e.name, score: e.score })),
          plata_extra_participants: externals
            .filter((e) => e.side === 'plata')
            .map((e) => ({ name: e.name, score: e.score })),
          third_place: thirdPlace,
          plata_third_place: plataThird,
        });
      return write(`/tournaments/${tid}/gp/start-playoffs`, {
        advancing_player_ids: ordered,
        extra_participants: extraBody.length ? extraBody : null,
        double_elimination: format === 'double',
        espejo: format === 'espejo',
        ...(format !== 'double'
          ? {
              num_winners: format === 'single' ? winnersValue : 1,
              third_place: thirdPlace,
            }
          : {}),
        ...(composed
          ? {
              playoff_teams: composed.map((team) =>
                team.map((id) => (id.startsWith('ext_') ? `ext_${names.get(id)}` : id)),
              ),
            }
          : {}),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'tournament', tid] });
      void client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
      notifications.show({ message: tx('Tournament updated'), color: 'green' });
      onClose();
    },
  });
  const toggle = (id: string, on: boolean) =>
    setChosen((cur) => (on ? [...(cur ?? initial), id] : (cur ?? initial).filter((x) => x !== id)));
  const enough = split
    ? sideIds('oro').length + externals.filter((e) => e.side === 'oro').length >= 2 &&
      sideIds('plata').length + externals.filter((e) => e.side === 'plata').length >= 2
    : poolIds.length >= (mex ? 4 : 2);
  const addExternal = () => {
    if (!extName.trim()) return;
    setExternals((cur) => [
      ...cur,
      {
        id: String(Date.now() + cur.length),
        name: extName.trim(),
        score: Number(extScore) || 0,
        side: extSide,
      },
    ]);
    setExtName('');
    setExtScore(0);
  };
  const autoTeams = () => {
    const out: string[][] = [];
    for (let i = 0; i + 1 < poolIds.length; i += 2) out.push([poolIds[i]!, poolIds[i + 1]!]);
    setTeams(out);
  };
  const taken = new Set(teams.flat().filter(Boolean));

  // Bracket entries: composed teams, or the selection (players pair up unless the entries are teams).
  const composedCount = compose ? teams.filter((t) => t.length > 1 && t.every(Boolean)).length : 0;
  const rawEntries = poolIds.length;
  const entries = composedCount || (fixedTeams ? rawEntries : Math.floor(rawEntries / 2));
  const winnerChoices = winnerOptions(entries);
  const winnersValue = winnerChoices.some((o) => o.value === Number(winners))
    ? Number(winners)
    : (winnerChoices[0]?.value ?? 1);
  const side = (name: 'oro' | 'plata') => {
    const players = sideIds(name).length + externals.filter((e) => e.side === name).length;
    return fixedTeams ? players : Math.floor(players / 2);
  };
  const goldN = side('oro');
  const silverN = side('plata');
  const warnings = split
    ? [
        ...(['oro', 'plata'] as const).flatMap((k) => {
          const label = k === 'oro' ? tx('Gold') : tx('Silver');
          const players = sideIds(k).length + externals.filter((e) => e.side === k).length;
          if (!fixedTeams && players % 2)
            return [
              tx('{bracket} bracket needs an even number of players to form teams.', {
                bracket: label,
              }),
            ];
          if ((k === 'oro' ? goldN : silverN) < 2)
            return [tx('{bracket} bracket needs at least 2 entries.', { bracket: label })];
          return [];
        }),
        ...(thirdPlace && goldN < 4
          ? [
              tx('{bracket} bracket needs at least 4 entries for a 3rd-place match.', {
                bracket: tx('Gold'),
              }),
            ]
          : []),
        ...(plataThird && silverN < 4
          ? [
              tx('{bracket} bracket needs at least 4 entries for a 3rd-place match.', {
                bracket: tx('Silver'),
              }),
            ]
          : []),
      ]
    : [];
  const estimate = (() => {
    if (split) {
      if (goldN < 2 || silverN < 2) return null;
      return {
        count:
          bracketMatches(goldN, 'single', 1, thirdPlace) +
          bracketMatches(silverN, 'single', 1, plataThird),
        rows: [
          [tx('Gold'), sequenceText(singleSequence(goldN, 1, thirdPlace))],
          [tx('Silver'), sequenceText(singleSequence(silverN, 1, plataThird))],
        ] as [string, string][],
      };
    }
    if (entries < 2) return null;
    const winnersN = format === 'single' ? winnersValue : 1;
    const count = bracketMatches(
      entries,
      format as 'single' | 'double' | 'espejo',
      winnersN,
      thirdPlace,
    );
    if (format === 'single')
      return {
        count,
        rows: [['', sequenceText(singleSequence(entries, winnersN, thirdPlace))]] as [
          string,
          string,
        ][],
      };
    const seq =
      format === 'double' ? doubleSequences(entries) : espejoSequences(entries, thirdPlace);
    return {
      count,
      rows: [
        [tx('Winners bracket'), sequenceText(seq.wb)],
        ...(seq.lb.length ? [[tx('Losers bracket'), sequenceText(seq.lb)]] : []),
      ] as [string, string][],
    };
  })();

  return (
    <ResponsiveSheet opened onClose={onClose} title={title} size="lg">
      <Stack>
        {start.error && <Notice tone="danger">{tx(start.error.message)}</Notice>}
        <Group justify="space-between" align="flex-end">
          <SegmentedControl
            size="xs"
            value={format}
            onChange={(v) => setFormat(v as Format)}
            aria-label={tx('Play-off format')}
            data={[
              { value: 'single', label: tx('Single elimination') },
              { value: 'double', label: tx('Double elimination') },
              ...(mex
                ? []
                : [
                    { value: 'espejo', label: tx('Mirror (Espejo)') },
                    { value: 'split', label: tx('Gold / Silver split') },
                  ]),
            ]}
          />
          {mex && (
            <NumberInput
              label={tx('Players advancing')}
              min={4}
              max={playerCount}
              step={2}
              w={150}
              value={count}
              onChange={(v) => {
                setCount(v);
                setChosen(null);
              }}
            />
          )}
        </Group>
        {!mex && format === 'single' && (
          <Group align="flex-end">
            <NativeSelect
              label={tx('Winners')}
              description={tx('Equal winners at the top')}
              data={winnerChoices.map((o) => ({ value: String(o.value), label: o.label }))}
              value={String(winnersValue)}
              onChange={(e) => setWinners(Number(e.currentTarget.value))}
            />
          </Group>
        )}
        {format !== 'double' && !mex && (
          <Switch
            label={split ? tx('Third-place match (Gold)') : tx('Third-place match')}
            checked={thirdPlace}
            onChange={(e) => setThirdPlace(e.currentTarget.checked)}
          />
        )}
        {split && (
          <Switch
            label={tx('Third-place match (Silver)')}
            checked={plataThird}
            onChange={(e) => setPlataThird(e.currentTarget.checked)}
          />
        )}
        {split && (
          <NumberInput
            label={tx('Top places per group to Gold')}
            description={tx(
              'Changing this resets every group: places 1 to N go to Gold, the rest to Silver.',
            )}
            min={0}
            allowDecimal={false}
            w={220}
            value={cutoff}
            onChange={(v) => applyCutoff(Number(v) || 0)}
          />
        )}
        {warnings.map((w) => (
          <Notice key={w} tone="warning" role="alert">
            {w}
          </Notice>
        ))}
        {estimate && (
          <Stack gap={2} data-testid="playoff-estimate">
            <Text size="sm" fw={600}>
              {tx('{n} matches', { n: estimate.count })}
              {split && ` · ${tx('Gold')} ${goldN} · ${tx('Silver')} ${silverN}`}
            </Text>
            {estimate.rows
              .filter(([, seq]) => seq)
              .map(([label, seq]) => (
                <Text key={label + seq} size="xs" c="dimmed">
                  {label ? `${label}: ` : ''}
                  {seq}
                </Text>
              ))}
          </Stack>
        )}
        <Text size="sm" fw={600}>
          {tx('Recommended seeding')}
        </Text>
        {rec.isPending ? (
          <Loader size="sm" />
        ) : rec.error ? (
          <Notice tone="danger">{tx(rec.error.message)}</Notice>
        ) : split ? (
          <Stack gap={6} data-testid="playoff-split">
            {rows.map((r) => (
              <Group key={r.player_id} justify="space-between" wrap="nowrap">
                <Group gap={6}>
                  <Text size="sm" c={r.withdrawn ? 'dimmed' : undefined}>
                    {r.player}
                  </Text>
                  {r.group && (
                    <StatusBadge size="xs">
                      {tx('Group {name}', { name: r.group })}
                      {r.group_rank ? ` #${r.group_rank}` : ''}
                    </StatusBadge>
                  )}
                </Group>
                <SegmentedControl
                  size="xs"
                  disabled={r.withdrawn}
                  aria-label={r.player}
                  value={sides[r.player_id] ?? 'out'}
                  onChange={(v) => setAssign({ ...sides, [r.player_id]: v as Side })}
                  data={[
                    { value: 'oro', label: tx('Gold') },
                    { value: 'plata', label: tx('Silver') },
                    { value: 'out', label: tx('Out') },
                  ]}
                />
              </Group>
            ))}
          </Stack>
        ) : (
          <Stack gap={4} data-testid="playoff-candidates">
            {rows.map((r, i) => (
              <Checkbox
                key={r.player_id}
                disabled={r.withdrawn}
                checked={selected.includes(r.player_id)}
                onChange={(e) => toggle(r.player_id, e.currentTarget.checked)}
                label={
                  <Group gap={6}>
                    <Text size="sm">
                      {i + 1}. {r.player}
                    </Text>
                    {r.group && (
                      <StatusBadge size="xs">
                        {tx('Group {name}', { name: r.group })}
                        {r.group_rank ? ` #${r.group_rank}` : ''}
                      </StatusBadge>
                    )}
                    {mex && (
                      <Text size="xs" c="dimmed">
                        {r.ranked_by_avg && r.estimated_points != null
                          ? `${r.estimated_points.toFixed(1)}*`
                          : (r.total_points ?? 0)}{' '}
                        {tx('pts')}
                      </Text>
                    )}
                    {r.withdrawn && (
                      <StatusBadge size="xs" variant="outline">
                        {tx('Withdrawn')}
                      </StatusBadge>
                    )}
                  </Group>
                }
              />
            ))}
            {mex && rows.some((r) => r.ranked_by_avg) && (
              <Text size="xs" c="dimmed">
                {tx('* Estimated points (players have played different numbers of matches)')}
              </Text>
            )}
          </Stack>
        )}
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {tx('External participants')}
          </Text>
          <Text size="xs" c="dimmed">
            {tx(
              'Add someone who did not play the earlier rounds. The score places them in the seeding.',
            )}
          </Text>
          {externals.map((e) => (
            <Group key={e.id} justify="space-between" wrap="nowrap">
              <Text size="sm">
                {e.name} · {e.score}
                {split && ` · ${e.side === 'oro' ? tx('Gold') : tx('Silver')}`}
              </Text>
              <Button
                variant="subtle"
                color="red"
                size="compact-sm"
                aria-label={tx('Remove {name}', { name: e.name })}
                onClick={() => setExternals(externals.filter((x) => x.id !== e.id))}
              >
                <IconX size={14} />
              </Button>
            </Group>
          ))}
          <Group gap="xs" align="flex-end" wrap="nowrap">
            <TextInput
              flex={1}
              aria-label={tx('External participant name')}
              placeholder={tx('Name')}
              value={extName}
              onChange={(e) => setExtName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addExternal();
                }
              }}
            />
            <NumberInput
              w={90}
              aria-label={tx('Seed score')}
              placeholder={tx('Score')}
              min={0}
              allowDecimal={false}
              value={extScore}
              onChange={setExtScore}
            />
            {split && (
              <NativeSelect
                aria-label={tx('Bracket')}
                value={extSide}
                onChange={(e) => setExtSide(e.currentTarget.value as 'oro' | 'plata')}
                data={[
                  { value: 'oro', label: tx('Gold') },
                  { value: 'plata', label: tx('Silver') },
                ]}
              />
            )}
            <Button variant="light" aria-label={tx('Add participant')} onClick={addExternal}>
              <IconPlus size={16} />
            </Button>
          </Group>
        </Stack>
        {composable && !fixedTeams && !split && (
          <Stack gap="xs">
            <Switch
              label={tx('Compose teams by hand')}
              description={tx('Choose each pair yourself instead of pairing adjacent seeds.')}
              checked={compose}
              onChange={(e) => {
                setCompose(e.currentTarget.checked);
                if (e.currentTarget.checked && !teams.length) autoTeams();
              }}
            />
            {compose && (
              <Stack gap={6}>
                {teams.map((team, ti) => (
                  <Group key={ti} gap="xs" wrap="nowrap">
                    <Text size="sm" w={60}>
                      {tx('Team {n}', { n: ti + 1 })}
                    </Text>
                    {[0, 1].map((slot) => (
                      <NativeSelect
                        key={slot}
                        flex={1}
                        aria-label={tx('Team {n}, player {p}', { n: ti + 1, p: slot + 1 })}
                        value={team[slot] ?? ''}
                        onChange={(e) =>
                          setTeams(
                            teams.map((t, i) =>
                              i === ti
                                ? t.map((v, j) => (j === slot ? e.currentTarget.value : v))
                                : t,
                            ),
                          )
                        }
                        data={[
                          { value: '', label: '—' },
                          ...poolIds.map((id) => ({
                            value: id,
                            label: names.get(id) ?? id,
                            disabled: taken.has(id) && team[slot] !== id,
                          })),
                        ]}
                      />
                    ))}
                    <Button
                      variant="subtle"
                      color="red"
                      size="compact-sm"
                      aria-label={tx('Remove team {n}', { n: ti + 1 })}
                      onClick={() => setTeams(teams.filter((_, i) => i !== ti))}
                    >
                      <IconX size={14} />
                    </Button>
                  </Group>
                ))}
                <Group gap="xs">
                  <Button
                    variant="light"
                    size="compact-md"
                    onClick={() => setTeams([...teams, ['', '']])}
                  >
                    {tx('Add team')}
                  </Button>
                  <Button variant="default" size="compact-md" onClick={autoTeams}>
                    {tx('Auto-pair')}
                  </Button>
                </Group>
              </Stack>
            )}
          </Stack>
        )}
        <Text size="sm" c="dimmed">
          {mex
            ? tx(
                'Adjacent seeds are paired into teams. This updates the tournament and its public view.',
              )
            : tx('This updates the tournament and its public view.')}
        </Text>
        <Group justify="flex-end" className={classes.footer}>
          <Button variant="default" size="touch" onClick={onClose}>
            {tx('Cancel')}
          </Button>
          <Button
            size="touch"
            disabled={!enough}
            loading={start.isPending}
            onClick={() => start.mutate()}
          >
            {tx('Continue')}
          </Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
