import { lazy, Suspense } from 'react';
import { Group, Paper, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { sportProps } from '../../theme';
import { Notice, PlayerName, SportMark, StatTile } from '../../ui';
import { MatchLine } from './MatchLine';
import type { CardSource } from './source';
import type { Counterpart, ScopedCard, ScopeOption, SportStats } from './types';

// The charts chunk loads only when a card has a trend to draw.
const PlayerSparkline = lazy(() => import('../player/charts/PlayerSparkline'));

/** A wider card (club, community, everything) from the caller's session. */
export function useScopedCard(source: CardSource | undefined, key: unknown[], path: string | null) {
  return useQuery({
    queryKey: [source?.realm ?? 'public', 'card', ...key],
    enabled: !!source && !!path,
    retry: false,
    queryFn: () => source!.fetch<ScopedCard>(path!),
  });
}

/** A wider card that did not load: a club's cards are for its members and organizers only (403). */
export function CardError({ error }: { error: unknown }) {
  useLocale();
  if ((error as { status?: number } | null)?.status === 403)
    return (
      <Text size="sm" c="dimmed" data-testid="card-members-only">
        {tx("Only club members and the club's organizers can open this card.")}
      </Text>
    );
  return <Notice tone="danger">{tx('Could not load player.')}</Notice>;
}

/** The `/player-cards/{profile}` query of a card's own scope: another player's card in the same scope. */
export function scopeQuery(card: ScopedCard): string {
  const q = new URLSearchParams();
  const id = card.scope.id;
  if (id && card.scope.kind === 'club') q.set('club_id', id);
  if (id && card.scope.kind === 'season') q.set('season_id', id);
  if (id && card.scope.kind === 'community') q.set('community_id', id);
  if (card.sport) q.set('sport', card.sport);
  const text = q.toString();
  return text ? `?${text}` : '';
}

/** The name of a card's scope: the club or community, or "All events". */
export const scopeLabel = (scope: ScopeOption) =>
  scope.kind === 'all' || !scope.label ? tx('All events') : scope.label;

function SportBlock({ s, club, single }: { s: SportStats; club: boolean; single: boolean }) {
  useLocale();
  const record = [s.wins, s.losses, ...(s.draws ? [s.draws] : [])].join('–');
  return (
    <Stack gap="sm" {...sportProps(s.sport)} data-testid="card-sport">
      {!single && <SportMark sport={s.sport} />}
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md" verticalSpacing="md">
        <StatTile
          label={club ? tx('Club ELO') : tx('ELO')}
          value={s.elo == null ? '—' : Math.round(s.elo)}
        />
        <StatTile label={tx('Matches')} value={s.matches} />
        <StatTile label={s.draws ? tx('W–L–D') : tx('W–L')} value={record} />
        {s.rank != null ? (
          <StatTile label={tx('Rank')} value={`#${s.rank}`} />
        ) : (
          <StatTile
            label={tx('Win rate')}
            value={s.matches ? `${Math.round((s.wins / s.matches) * 100)}%` : '—'}
          />
        )}
      </SimpleGrid>
      {s.tier_name && (
        <Text size="sm" c="dimmed">
          {tx('Tier')}: {s.tier_name}
        </Text>
      )}
      {s.elo_history.length > 1 && (
        <Suspense fallback={<Skeleton h={56} />}>
          <PlayerSparkline
            data={s.elo_history}
            color="var(--sport-accent)"
            label={tx('{value1} ELO trend', { value1: s.sport })}
          />
        </Suspense>
      )}
    </Stack>
  );
}

function People({
  title,
  rows,
  testId,
  onProfile,
}: {
  title: string;
  rows: Counterpart[];
  testId: string;
  onProfile?: (profileId: string) => void;
}) {
  useLocale();
  if (!rows.length) return null;
  return (
    <Stack gap={6} data-testid={testId}>
      <Text variant="eyebrow">{title}</Text>
      {rows.map((r) => (
        <Group
          key={`${r.profile_id ?? ''}:${r.name}`}
          justify="space-between"
          wrap="nowrap"
          gap="sm"
        >
          <Text size="sm" fw={600} truncate component="div" miw={0}>
            <PlayerName
              name={r.name}
              id={r.profile_id ?? undefined}
              onOpen={onProfile && r.profile_id ? () => onProfile(r.profile_id!) : undefined}
            />
          </Text>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {tx('{games} games · {pct}% won', {
              games: r.matches,
              pct: r.matches ? Math.round((r.wins / r.matches) * 100) : 0,
            })}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

// A player's record within one scope: rating, record and trend per sport, the people they play with
// and against most (the scouting part), then their latest matches.
export function ScopedCardBody({
  card,
  onMember,
  onProfile,
}: {
  card: ScopedCard;
  /** A team card lists its players; a tap opens that player's card in the same scope. */
  onMember?: (playerId: string) => void;
  /** A tap on a linked partner's or opponent's name opens their card in the same scope. */
  onProfile?: (profileId: string) => void;
}) {
  useLocale();
  if (card.is_team)
    return (
      <Stack gap="sm" data-testid="scoped-player-card" data-team="">
        <Text size="sm" c="dimmed">
          {tx('Ratings belong to the players of a team. Pick a player to see their record.')}
        </Text>
        {card.members.map((m) => (
          <Paper key={m.player_id} variant="row" p="sm" data-testid="card-team-member">
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Text fw={600} component="div" miw={0}>
                <PlayerName
                  name={m.name}
                  id={m.player_id}
                  onOpen={m.has_profile && onMember ? () => onMember(m.player_id) : undefined}
                />
              </Text>
              {!m.has_profile && (
                <Text size="xs" c="dimmed">
                  {tx('No profile')}
                </Text>
              )}
            </Group>
          </Paper>
        ))}
      </Stack>
    );
  const club = card.scope.kind === 'club' || card.scope.kind === 'season';
  return (
    <Stack gap="md" data-testid="scoped-player-card">
      {card.stats.length === 0 && (
        <Text c="dimmed" size="sm">
          {tx('No matches yet.')}
        </Text>
      )}
      {card.stats.map((s) => (
        <SportBlock key={s.sport} s={s} club={club} single={card.stats.length === 1} />
      ))}
      {(card.top_partners.length > 0 || card.top_opponents.length > 0) && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <People
            title={tx('Top partners')}
            rows={card.top_partners}
            testId="card-partners"
            onProfile={onProfile}
          />
          <People
            title={tx('Top opponents')}
            rows={card.top_opponents}
            testId="card-opponents"
            onProfile={onProfile}
          />
        </SimpleGrid>
      )}
      {card.recent_matches.length > 0 && (
        <Stack gap="xs">
          <Text variant="eyebrow">{tx('Recent matches')}</Text>
          {card.recent_matches.map((m, i) => (
            <MatchLine key={i} m={m} player={card.name} onPlayer={onProfile} />
          ))}
        </Stack>
      )}
      {card.unlisted_matches > 0 && (
        <Text size="xs" c="dimmed" data-testid="card-unlisted">
          {tx('{n} matches in unlisted events count here but are not listed.', {
            n: card.unlisted_matches,
          })}
        </Text>
      )}
    </Stack>
  );
}
