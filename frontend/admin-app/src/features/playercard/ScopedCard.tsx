import { lazy, Suspense } from 'react';
import { Group, Paper, SimpleGrid, Skeleton, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { sportProps } from '../../theme';
import {
  HistoryLimit,
  historyLimitParam,
  Notice,
  PlayerName,
  SportMark,
  StatTile,
  type HistoryLimitValue,
} from '../../ui';
import { MatchLine } from './MatchLine';
import type { CardSource } from './source';
import type { Counterpart, ScopedCard, ScopeOption, SportStats } from './types';

// The charts chunk loads only when a card has a trend to draw.
const PlayerSparkline = lazy(() => import('../player/charts/PlayerSparkline'));

/**
 * A wider card (club, community, everything) from the caller's session, listing `limit` matches.
 * A change of `limit` keeps the card on screen while the new list loads.
 */
export function useScopedCard(
  source: CardSource | undefined,
  key: unknown[],
  path: string | null,
  limit: HistoryLimitValue,
) {
  const queryKey = [source?.realm ?? 'public', 'card', ...key];
  return useQuery({
    queryKey: [...queryKey, limit],
    enabled: !!source && !!path,
    retry: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery &&
      JSON.stringify(previousQuery.queryKey.slice(0, -1)) === JSON.stringify(queryKey)
        ? previous
        : undefined,
    queryFn: () =>
      source!.fetch<ScopedCard>(
        `${path!}${path!.includes('?') ? '&' : '?'}limit=${historyLimitParam(limit)}`,
      ),
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

/** The "Recent matches" list of a card, with the 10 / 25 / All choice when there is more to show. */
function History({
  card,
  history,
  onProfile,
}: {
  card: ScopedCard;
  history: HistoryChoice;
  onProfile?: (profileId: string) => void;
}) {
  useLocale();
  if (!card.recent_matches.length && card.recent_total <= 0) return null;
  return (
    <Stack gap="xs" data-testid="card-history">
      <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
        <Text variant="eyebrow">{tx('Recent matches')}</Text>
        <HistoryLimit value={history.limit} onChange={history.onChange} total={card.recent_total} />
      </Group>
      {card.recent_matches.map((m, i) => (
        <MatchLine key={i} m={m} player={card.name} onPlayer={onProfile} />
      ))}
    </Stack>
  );
}

function Unlisted({ n }: { n: number }) {
  useLocale();
  if (n <= 0) return null;
  return (
    <Text size="xs" c="dimmed" data-testid="card-unlisted">
      {tx('{n} matches in unlisted events count here but are not listed.', { n })}
    </Text>
  );
}

// A team's players, each with their own rating in the scope; a tap opens that player's card.
function TeamMembers({
  card,
  onMember,
}: {
  card: ScopedCard;
  onMember?: (playerId: string) => void;
}) {
  useLocale();
  return (
    <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="xs" data-testid="card-team-members">
      {card.members.map((m) => (
        <Paper key={m.player_id} variant="row" p="sm" data-testid="card-team-member">
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text fw={600} truncate component="div" miw={0}>
              <PlayerName
                name={m.name}
                id={m.player_id}
                onOpen={m.has_profile && onMember ? () => onMember(m.player_id) : undefined}
              />
            </Text>
            {!m.has_profile ? (
              <Text size="xs" c="dimmed">
                {tx('No profile')}
              </Text>
            ) : (
              m.elo != null && (
                <Text size="sm" fw={600}>
                  {Math.round(m.elo)}
                </Text>
              )
            )}
          </Group>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

// The record of a team's two players together in this scope: the same numbers as a player's card
// except the rating (ratings belong to the players, shown on each name above).
function PairBody({
  card,
  history,
  onMember,
  onProfile,
}: {
  card: ScopedCard;
  history: HistoryChoice;
  onMember?: (playerId: string) => void;
  onProfile?: (profileId: string) => void;
}) {
  useLocale();
  return (
    <Stack gap="md" data-testid="scoped-player-card" data-team="" data-pair="">
      <TeamMembers card={card} onMember={onMember} />
      <Text variant="eyebrow">{tx('Record together')}</Text>
      {card.stats.length === 0 && card.unlisted_matches === 0 && (
        <Text c="dimmed" size="sm" data-testid="card-pair-empty">
          {tx('No matches together yet.')}
        </Text>
      )}
      {card.stats.map((s) => (
        <Stack key={s.sport} gap="sm" {...sportProps(s.sport)} data-testid="card-sport">
          {card.stats.length > 1 && <SportMark sport={s.sport} />}
          <SimpleGrid cols={{ base: 3 }} spacing="md" verticalSpacing="md">
            <StatTile label={tx('Matches')} value={s.matches} />
            <StatTile
              label={s.draws ? tx('W–L–D') : tx('W–L')}
              value={[s.wins, s.losses, ...(s.draws ? [s.draws] : [])].join('–')}
            />
            <StatTile
              label={tx('Win rate')}
              value={s.matches ? `${Math.round((s.wins / s.matches) * 100)}%` : '—'}
            />
          </SimpleGrid>
        </Stack>
      ))}
      <People
        title={tx('Top opponents')}
        rows={card.top_opponents}
        testId="card-opponents"
        onProfile={onProfile}
      />
      <History card={card} history={history} onProfile={onProfile} />
      <Unlisted n={card.unlisted_matches} />
    </Stack>
  );
}

/** The viewer's history length (`useHistoryLimit`) and how to change it. */
export interface HistoryChoice {
  limit: HistoryLimitValue;
  onChange: (value: HistoryLimitValue) => void;
}

// A player's record within one scope: rating, record and trend per sport, the people they play with
// and against most (the scouting part), then their latest matches. A team's card is its pair's record.
export function ScopedCardBody({
  card,
  history,
  onMember,
  onProfile,
}: {
  card: ScopedCard;
  history: HistoryChoice;
  /** A team card lists its players; a tap opens that player's card in the same scope. */
  onMember?: (playerId: string) => void;
  /** A tap on a linked partner's or opponent's name opens their card in the same scope. */
  onProfile?: (profileId: string) => void;
}) {
  useLocale();
  if (card.is_team && card.pair)
    return <PairBody card={card} history={history} onMember={onMember} onProfile={onProfile} />;
  if (card.is_team)
    // A player of the team has no profile, so there is no shared record: only the players to open.
    return (
      <Stack gap="sm" data-testid="scoped-player-card" data-team="">
        <TeamMembers card={card} onMember={onMember} />
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
      <History card={card} history={history} onProfile={onProfile} />
      <Unlisted n={card.unlisted_matches} />
    </Stack>
  );
}
