import { useMemo, useState, type ReactNode } from 'react';
import { Paper, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import type { Match, TvSettings } from '../../types';
import type { Ctx } from '../../admin/tournament/scoring';
import { ZoomableImage } from '../../ui';
import { toMatchView } from './adapters';
import { MatchCard } from './MatchCard';
import classes from './Workspace.module.css';

interface Round {
  label: string;
  matches: Match[];
}
interface Band {
  key: string;
  title: string | null;
  rounds: Round[];
}

// Rounds in the order the engine emits them, split into Winners and Losers bands for Espejo
// (`bracket_side`) and double elimination (labels that start with "Losers").
export function bandsOf(matches: Match[]): Band[] {
  const side = (m: Match) =>
    m.bracket_side ?? (/^\s*(losers?|lb)\b/i.test(m.round_label) ? 'losers' : 'winners');
  const bands = new Map<string, Map<string, Match[]>>();
  for (const m of matches) {
    const key = side(m);
    const rounds = bands.get(key) ?? new Map<string, Match[]>();
    rounds.set(m.round_label, [...(rounds.get(m.round_label) ?? []), m]);
    bands.set(key, rounds);
  }
  const out: Band[] = [];
  for (const key of ['winners', 'losers']) {
    const rounds = bands.get(key);
    if (!rounds) continue;
    out.push({
      key,
      title: bands.size > 1 ? (key === 'winners' ? tx('Winners') : tx('Losers')) : null,
      rounds: [...rounds].map(([label, list]) => ({
        label,
        matches: list.slice().sort((a, b) => (a.slot_number ?? 0) - (b.slot_number ?? 0)),
      })),
    });
  }
  return out;
}

function Slot({
  match,
  ctx,
  settings,
  actions,
}: {
  match: Match;
  ctx: Ctx;
  settings: TvSettings;
  actions?: (match: Match) => ReactNode;
}) {
  const view = toMatchView(match, settings, ctx);
  return (
    <div className={classes.slot} data-testid="bracket-slot">
      <MatchCard match={view} density="slot" testId={null} actions={actions?.(match)} />
    </div>
  );
}

// The play-off bracket. Wide screens: one column per round with connectors. Phones: a round pager.
// "Diagram" shows the server-rendered picture of the same bracket (`/{prefix}/playoffs-schema`).
export function Bracket({
  matches,
  ctx,
  settings,
  tid,
  prefix,
  actions,
  pendingChip = false,
}: {
  matches: Match[];
  ctx: Ctx;
  settings: TvSettings;
  tid: string;
  prefix: string;
  actions?: (match: Match) => ReactNode;
  /** Phone round pager gets a first "To play" chip listing every match that can be scored now. */
  pendingChip?: boolean;
}) {
  useLocale();
  const phone = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const bands = useMemo(() => bandsOf(matches), [matches]);
  const [mode, setMode] = useState<'cards' | 'diagram'>('cards');
  const rounds = bands.flatMap((b) => b.rounds.map((r) => ({ ...r, band: b.key })));
  const [round, setRound] = useState<string | null>(null);
  const pending = matches.filter(
    (m) => m.status !== 'completed' && m.team1.length && m.team2.length && !m.walkover,
  );
  const withPending = pendingChip && pending.length > 0;
  const picked =
    withPending && (round === null || round === 'pending')
      ? undefined
      : (rounds.find((r) => `${r.band}:${r.label}` === round) ?? rounds[0]);
  const showPending = withPending && !picked;
  if (!matches.length)
    return (
      <Paper variant="dashed" p="lg">
        <Text c="dimmed">{tx('The bracket appears once the play-offs start.')}</Text>
      </Paper>
    );
  const sides = bands.length > 1 ? ['winners', 'losers'] : [undefined];
  return (
    <Stack gap="md" data-testid="bracket">
      <SegmentedControl
        size="xs"
        w="fit-content"
        value={mode}
        onChange={(v) => setMode(v as 'cards' | 'diagram')}
        aria-label={tx('Bracket view')}
        data={[
          { value: 'cards', label: tx('Cards') },
          { value: 'diagram', label: tx('Diagram') },
        ]}
      />
      {mode === 'diagram' ? (
        <Stack gap="md">
          {sides.map((side) => (
            <ZoomableImage
              key={side ?? 'main'}
              src={`/api/tournaments/${tid}/${prefix}/playoffs-schema${side && bands.length > 1 ? `?side=${side}` : ''}`}
              alt={side === 'losers' ? tx('Losers') : tx('Play-off bracket')}
              maxHeight={560}
              testId="bracket-diagram"
            />
          ))}
          <Text size="xs" c="dimmed">
            {tx('Pinch or double-tap to zoom')}
          </Text>
        </Stack>
      ) : phone ? (
        <Stack gap="sm">
          <SegmentedControl
            size="xs"
            fullWidth
            value={picked ? `${picked.band}:${picked.label}` : 'pending'}
            onChange={setRound}
            data={[
              ...(withPending ? [{ value: 'pending', label: tx('To play') }] : []),
              ...rounds.map((r) => ({
                value: `${r.band}:${r.label}`,
                label:
                  bands.length > 1
                    ? `${r.band === 'losers' ? tx('L', { context: 'bracket' }) : tx('W', { context: 'bracket' })} ${formatRoundLabel(r.label)}`
                    : formatRoundLabel(r.label),
              })),
            ]}
            aria-label={tx('Round', { context: 'knockout' })}
          />
          {(showPending
            ? pending.slice().sort((a, b) => (a.slot_number ?? 0) - (b.slot_number ?? 0))
            : (picked?.matches ?? [])
          ).map((m) => (
            <Slot key={m.id} match={m} ctx={ctx} settings={settings} actions={actions} />
          ))}
        </Stack>
      ) : (
        bands.map((band) => (
          <Stack key={band.key} gap="xs">
            {band.title && <Title order={3}>{band.title}</Title>}
            <div className={classes.bracket}>
              {band.rounds.map((r) => (
                <div key={r.label} className={classes.column}>
                  <Text variant="eyebrow">{formatRoundLabel(r.label)}</Text>
                  <div className={classes.cards}>
                    {r.matches.map((m) => (
                      <Slot key={m.id} match={m} ctx={ctx} settings={settings} actions={actions} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Stack>
        ))
      )}
    </Stack>
  );
}
