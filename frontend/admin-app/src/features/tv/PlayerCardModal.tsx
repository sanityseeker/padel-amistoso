import { useEffect } from 'react';
import { Alert, Group, Loader, Modal, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { publicApi } from '../../events/api';
import { formatSets } from '../../admin/tournament/scoring';
import type { Score, SetDecider } from '../../types';

interface Card {
  player_name: string;
  elo: number | null;
  elo_delta_total: number | null;
  elo_scope?: string;
  matches: number;
  wins: number;
  losses: number;
  recent_matches?: {
    round_label?: string;
    round_number?: number;
    team1: string[];
    team2: string[];
    score?: Score | null;
    sets?: Score[] | null;
    decider?: SetDecider | null;
    elo_delta: number | null;
  }[];
}

const AUTO_CLOSE_MS = 30_000;

// A player's card within one tournament (GET /tournaments/{tid}/players/{pid}/public-card). It is the same
// public data as the legacy card; on a TV nobody is there to close it, so it closes itself after a while.
export function PlayerCardModal({
  tid,
  playerId,
  onClose,
}: {
  tid: string;
  playerId: string | null;
  onClose: () => void;
}) {
  useLocale();
  const card = useQuery({
    queryKey: ['public', 'tv', tid, 'card', playerId],
    enabled: !!playerId,
    queryFn: () =>
      publicApi<Card>(
        `/tournaments/${encodeURIComponent(tid)}/players/${encodeURIComponent(playerId!)}/public-card`,
      ),
  });
  useEffect(() => {
    if (!playerId) return;
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [playerId, onClose]);
  const data = card.data;
  const delta = data?.elo_delta_total;
  return (
    <Modal
      opened={!!playerId}
      onClose={onClose}
      centered
      size="lg"
      title={data?.player_name ?? tx('Loading')}
    >
      {card.isPending && <Loader aria-label={tx('Loading')} />}
      {card.error && <Alert color="red">{tx('Could not load player.')}</Alert>}
      {data && (
        <Stack gap="md" data-testid="tv-player-card">
          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            {[
              [
                data.elo_scope === 'club' ? tx('Club ELO') : tx('ELO'),
                data.elo == null ? '—' : String(Math.round(data.elo)),
              ],
              [
                tx('ELO change'),
                delta == null ? '—' : `${delta > 0 ? '+' : ''}${Number(delta).toFixed(1)}`,
              ],
              [tx('Matches'), String(data.matches || 0)],
              [`${tx('W')}/${tx('L')}`, `${data.wins || 0}/${data.losses || 0}`],
            ].map(([label, value]) => (
              <Stack key={label} gap={0}>
                <Text size="xs" c="dimmed">
                  {label}
                </Text>
                <Text variant="score" size="xl">
                  {value}
                </Text>
              </Stack>
            ))}
          </SimpleGrid>
          <Text variant="eyebrow">{tx('Match history')}</Text>
          {!data.recent_matches?.length && (
            <Text c="dimmed" size="sm">
              {tx('No matches yet.')}
            </Text>
          )}
          {data.recent_matches?.map((m, i) => {
            const result = m.sets?.length
              ? formatSets(m.sets, m.decider ?? 'full_set')
              : m.score
                ? `${m.score[0]} – ${m.score[1]}`
                : tx('Vs');
            return (
              <Group key={i} justify="space-between" wrap="nowrap" gap="sm">
                <Stack gap={0} miw={0}>
                  <Text size="xs" c="dimmed">
                    {(m.round_label && formatRoundLabel(m.round_label)) ||
                      (m.round_number ? `R${m.round_number}` : '')}
                  </Text>
                  <Text size="sm">
                    {m.team1.join(' / ')} <b>{result}</b> {m.team2.join(' / ')}
                  </Text>
                </Stack>
                {m.elo_delta != null && (
                  <Text
                    fw={700}
                    c={m.elo_delta > 0 ? 'green' : m.elo_delta < 0 ? 'red' : 'dimmed'}
                    size="sm"
                  >
                    {m.elo_delta > 0 ? '+' : ''}
                    {Number(m.elo_delta).toFixed(1)}
                  </Text>
                )}
              </Group>
            );
          })}
        </Stack>
      )}
    </Modal>
  );
}
