import { useEffect, useState } from 'react';
import { Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TOURNAMENT_UPDATE_EVENT } from '../../shell/followTournament';
import { t as tx, useLocale } from '../../i18n';
import { publicApi } from '../../events/api';
import { Notice, PlayerName, ResponsiveSheet, StatTile } from '../../ui';
import { deltaColor, MatchLine, signed } from './MatchLine';
import { CardError, scopeLabel, scopeQuery, ScopedCardBody, useScopedCard } from './ScopedCard';
import { BackButton, useTrail } from './trail';
import type { CardSource } from './source';
import type { CardStage, EventCard, MatchStage, ScopeOption } from './types';

const AUTO_CLOSE_MS = 30_000;

type Step = { kind: 'event'; id: string } | { kind: 'profile'; id: string; query: string };

const STAGE_LABEL: Record<MatchStage, string> = {
  group: 'Group stage',
  rounds: 'Mexicano rounds',
  playoff: 'Play-offs',
};

/** The public (anonymous) card of one event; also refreshed by the shell's live updates. */
export const eventCardKey = (tid: string, playerId: string | null) => [
  'public',
  'tv',
  tid,
  'card',
  playerId,
];

// A player's card, opened from a name or a table row of one event. It starts on this event
// (GET /tournaments/{tid}/players/{pid}/public-card, anonymous, the same data as the legacy card).
// With a signed-in `source` (Hub, admin) a linked player's card switches to the event's wider scope:
// its club, else its community, else all events; the server decides which one. On a TV nobody is
// there to close the card, so it closes itself after a while (`autoClose={false}` on a phone).
export function PlayerCardModal({
  tid,
  playerId,
  onClose,
  autoClose = true,
  stage,
  source,
}: {
  tid: string;
  playerId: string | null;
  onClose: () => void;
  autoClose?: boolean;
  /** Stage of the table the card was opened from: the card starts on that stage only. */
  stage?: CardStage | null;
  /** The signed-in session that may open the wider scope; absent on public screens. */
  source?: CardSource;
}) {
  useLocale();
  const client = useQueryClient();
  const [whole, setWhole] = useState(false);
  const [wide, setWide] = useState(false);
  // A team's player picked in the wider scope (ratings belong to the players).
  const [member, setMember] = useState<string | null>(null);
  // Names tapped inside the card: another player of this event, or a profile in the wider scope.
  const trail = useTrail<Step>(playerId);
  const profileStep = trail.top?.kind === 'profile' ? trail.top : null;
  const eventStep = [...trail.items].reverse().find((s) => s.kind === 'event');
  const current = eventStep?.id ?? playerId;
  // Each opening (and each player opened from a name) starts on its own stage and on this event.
  useEffect(() => {
    setWhole(false);
    setWide(false);
    setMember(null);
  }, [current, stage]);
  // The followed tournament's live updates (TV) refresh an open card.
  useEffect(() => {
    if (!current) return;
    const changed = () => {
      void client.invalidateQueries({ queryKey: eventCardKey(tid, current) });
      if (source) void client.invalidateQueries({ queryKey: [source.realm, 'card', 'event', tid] });
    };
    window.addEventListener(TOURNAMENT_UPDATE_EVENT, changed);
    return () => window.removeEventListener(TOURNAMENT_UPDATE_EVENT, changed);
  }, [client, tid, current, source]);
  const card = useQuery({
    queryKey: eventCardKey(tid, current),
    enabled: !!current,
    queryFn: () =>
      publicApi<EventCard>(
        `/tournaments/${encodeURIComponent(tid)}/players/${encodeURIComponent(current!)}/public-card`,
      ),
  });
  useEffect(() => {
    if (!playerId || !autoClose) return;
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [playerId, onClose, autoClose]);
  const data = card.data;
  // Which wider scope this viewer may open is the server's answer for this session (a club only for
  // its members and organizers); the anonymous event card cannot know it.
  const scopes = useQuery({
    queryKey: [source?.realm ?? 'public', 'card', 'scopes', tid, current],
    enabled: !!source && !!current && !!data?.has_profile,
    retry: false,
    queryFn: () =>
      source!.fetch<ScopeOption[]>(
        `/tournaments/${encodeURIComponent(tid)}/players/${encodeURIComponent(current!)}/card-scopes`,
      ),
  });
  const wider = scopes.data?.find((s) => s.kind !== 'event');
  const canWiden = !!source && !!data?.has_profile && !!wider;
  const shownId = member ?? current;
  const scoped = useScopedCard(
    source,
    ['event', tid, shownId, wider?.kind],
    canWiden && wide && shownId
      ? `/tournaments/${encodeURIComponent(tid)}/players/${encodeURIComponent(shownId)}/card?scope=${wider!.kind}`
      : null,
  );
  // A profile opened from the wider card: shown in that card's own scope.
  const profile = useScopedCard(
    source,
    ['profile', profileStep?.id, profileStep?.query],
    profileStep ? `/player-cards/${encodeURIComponent(profileStep.id)}${profileStep.query}` : null,
  );
  const openProfile = (id: string) => {
    const from = profileStep ? profile.data : scoped.data;
    if (from && id !== from.profile_id)
      trail.open({ kind: 'profile', id, query: scopeQuery(from) });
  };
  const openEventPlayer = (id: string) => {
    if (id !== current) trail.open({ kind: 'event', id });
  };
  const openMember = (id: string) => {
    setMember(id);
    setWide(true);
  };
  // The stage switch only means something when the player has matches in more than one stage.
  const stageKnown =
    !!stage && !!data?.stages && data.stages.length > 1 && data.stages.includes(stage);
  const scope: string = stageKnown && !whole ? stage! : 'all';
  const stats = data?.stats?.[scope];
  const delta = stats ? stats.elo_delta : data?.elo_delta_total;
  const draws = stats ? stats.draws : (data?.draws ?? 0);
  const matches = stats ? stats.matches : (data?.matches ?? 0);
  const wins = stats ? stats.wins : (data?.wins ?? 0);
  const losses = stats ? stats.losses : (data?.losses ?? 0);
  const shown = (data?.recent_matches ?? []).filter((m) => scope === 'all' || m.stage === scope);
  const members = data?.members ?? [];
  const memberNames = members.map((m) => m.name);
  const eloLabel =
    data?.elo_scope === 'club'
      ? data.is_team
        ? tx('Average club ELO')
        : tx('Club ELO')
      : data?.is_team
        ? tx('Average ELO')
        : tx('ELO');
  const title = profileStep
    ? (profile.data?.name ?? tx('Loading'))
    : wide && member && scoped.data
      ? scoped.data.name
      : (data?.player_name ?? tx('Loading'));
  return (
    <ResponsiveSheet opened={!!playerId} onClose={onClose} size="lg" title={title}>
      {trail.top && <BackButton onClick={trail.back} />}
      {profileStep && (
        <>
          {profile.isPending && <Loader aria-label={tx('Loading')} />}
          {profile.error && <CardError error={profile.error} />}
          {profile.data && (
            <Stack gap="md" data-testid="profile-player-card">
              <Text variant="eyebrow" data-testid="card-scope-label">
                {scopeLabel(profile.data.scope)}
              </Text>
              <ScopedCardBody card={profile.data} onProfile={openProfile} />
            </Stack>
          )}
        </>
      )}
      {!profileStep && card.isPending && <Loader aria-label={tx('Loading')} />}
      {!profileStep && card.error && <Notice tone="danger">{tx('Could not load player.')}</Notice>}
      {!profileStep && data && (
        <Stack gap="md" data-testid="tv-player-card">
          {canWiden && (
            <SegmentedControl
              fullWidth
              size="xs"
              value={wide ? 'wide' : 'event'}
              onChange={(v) => {
                setWide(v === 'wide');
                if (v !== 'wide') setMember(null);
              }}
              aria-label={tx('Matches shown')}
              data={[
                { value: 'event', label: tx('This event') },
                { value: 'wide', label: scopeLabel(wider!) },
              ]}
              data-testid="card-scope"
            />
          )}
          {source && data.has_profile === false && (
            <Text size="sm" c="dimmed" data-testid="card-no-profile">
              {tx('This player has no profile yet, so the card shows this event only.')}
            </Text>
          )}
          {wide && canWiden ? (
            <>
              {scoped.isPending && <Loader aria-label={tx('Loading')} />}
              {scoped.error &&
                (member && (scoped.error as { status?: number }).status === 404 ? (
                  // A team's player without a profile: nothing wider than this event exists.
                  <Text size="sm" c="dimmed" data-testid="card-no-profile">
                    {tx('This player has no profile yet, so the card shows this event only.')}
                  </Text>
                ) : (
                  <CardError error={scoped.error} />
                ))}
              {scoped.data && (
                <ScopedCardBody card={scoped.data} onMember={openMember} onProfile={openProfile} />
              )}
            </>
          ) : (
            <>
              {stageKnown && (
                <SegmentedControl
                  fullWidth
                  size="xs"
                  value={whole ? 'all' : 'stage'}
                  onChange={(v) => setWhole(v === 'all')}
                  aria-label={tx('Matches shown')}
                  data={[
                    { value: 'stage', label: tx('This stage') },
                    { value: 'all', label: tx('Whole event') },
                  ]}
                  data-testid="tv-card-scope"
                />
              )}
              {stageKnown && (
                <Text variant="eyebrow" data-testid="tv-card-scope-label">
                  {scope === 'all' ? tx('Whole event') : tx(STAGE_LABEL[scope as MatchStage])}
                </Text>
              )}
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="md">
                <StatTile label={eloLabel} value={data.elo == null ? '—' : Math.round(data.elo)} />
                <StatTile
                  label={tx('ELO change')}
                  value={
                    delta == null ? (
                      '—'
                    ) : (
                      <Text span inherit c={deltaColor(Number(delta))}>
                        {signed(Number(delta))}
                      </Text>
                    )
                  }
                />
                <StatTile label={tx('Matches')} value={matches || 0} />
                <StatTile
                  label={draws ? tx('W–L–D') : tx('W–L')}
                  value={[wins || 0, losses || 0, ...(draws ? [draws] : [])].join('–')}
                />
              </SimpleGrid>
              {members.length > 0 && (
                <Stack gap="xs" data-testid="tv-card-members">
                  <Text variant="eyebrow">{tx('Members')}</Text>
                  {members.map((m) => {
                    const d = m.elo_delta?.[scope];
                    return (
                      <Paper key={m.player_id} variant="row" p="sm">
                        <Group justify="space-between" wrap="nowrap" gap="sm">
                          <Text fw={600} truncate component="div" miw={0}>
                            <PlayerName
                              name={m.name}
                              onOpen={canWiden ? () => openMember(m.player_id) : undefined}
                            />
                          </Text>
                          <Group gap="md" wrap="nowrap">
                            <Text size="sm">{m.elo == null ? '—' : Math.round(m.elo)}</Text>
                            {d != null && (
                              <Text fw={700} size="sm" c={deltaColor(Number(d))}>
                                {signed(Number(d))}
                              </Text>
                            )}
                          </Group>
                        </Group>
                      </Paper>
                    );
                  })}
                </Stack>
              )}
              <Text variant="eyebrow">{tx('Match history')}</Text>
              {!shown.length && (
                <Text c="dimmed" size="sm">
                  {tx('No matches yet.')}
                </Text>
              )}
              <Stack gap="xs">
                {shown.map((m, i) => (
                  <MatchLine
                    key={i}
                    m={m}
                    player={data.player_name}
                    members={memberNames}
                    onPlayer={openEventPlayer}
                  />
                ))}
              </Stack>
            </>
          )}
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
