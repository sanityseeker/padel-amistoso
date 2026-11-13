import { useMemo } from 'react';
import { ActionIcon, CopyButton, Group, Popover, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconAddressBook, IconCheck, IconCopy } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { playerApi } from '../../player/api';
import type { PlayerMatch } from '../../player/types';
import { sideOf } from './eventData';

/** One other player of an upcoming match, as GET /tournaments/{tid}/player/opponents returns them. */
interface CoPlayer {
  player_id: string;
  name: string;
  contact: string | null;
  match_id: string;
  round_number: number;
}

/**
 * The shared contacts of the other players in the signed-in player's upcoming matches, by match id.
 * Uses the tournament player token. Without one (read-only Hub entry) the map stays empty.
 */
export function useMatchContacts(
  tid: string | undefined,
  token: string | null,
  matchIds: string[],
) {
  const key = matchIds.join(',');
  const query = useQuery({
    // The match ids are in the key: a new round or a filled bracket slot loads the new names.
    queryKey: ['player', 'match-contacts', tid, token, key],
    enabled: !!tid && !!token && !!key,
    queryFn: () =>
      playerApi<{ opponents?: CoPlayer[] }>(
        `/tournaments/${tid}/player/opponents`,
        undefined,
        'GET',
        token,
      ),
    retry: false,
  });
  return useMemo(() => {
    const byMatch = new Map<string, CoPlayer[]>();
    for (const p of query.data?.opponents ?? []) {
      if (!p.contact?.trim()) continue;
      byMatch.set(p.match_id, [...(byMatch.get(p.match_id) ?? []), p]);
    }
    return byMatch;
  }, [query.data]);
}

// A small button on a match card: the partner's and the opponents' contacts, to arrange the match.
// Shown only when at least one of them shared a contact. A tap on a row copies the contact.
export function MatchContacts({
  match,
  people,
  expand,
  playerId,
}: {
  match: PlayerMatch;
  people: CoPlayer[] | undefined;
  expand: (ids: string[]) => string[];
  playerId: string;
}) {
  useLocale();
  if (!people?.length) return null;
  const mine = sideOf(match, expand, playerId);
  const own = mine ? expand(mine === 1 ? match.team1_ids : match.team2_ids) : [];
  const rows = people
    .map((p) => ({ ...p, partner: own.includes(p.player_id) }))
    .sort((a, b) => Number(b.partner) - Number(a.partner));
  return (
    <Popover position="bottom-end" width={300} withArrow shadow="md">
      <Popover.Target>
        <ActionIcon
          variant="light"
          size="touch"
          aria-label={tx('Contacts of the other players')}
          title={tx('Contacts of the other players')}
          data-testid="match-contacts-button"
        >
          <IconAddressBook size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown data-testid="match-contacts">
        <Stack gap="xs">
          <Text variant="eyebrow">{tx('Tap to copy')}</Text>
          {rows.map((p) => (
            <CopyButton key={p.player_id} value={p.contact!.trim()}>
              {({ copied, copy }) => (
                <UnstyledButton
                  onClick={copy}
                  aria-label={tx('Copy the contact of {name}', { name: p.name })}
                >
                  <Group justify="space-between" wrap="nowrap" gap="sm" align="flex-start">
                    <Stack gap={0} miw={0}>
                      <Text size="sm" fw={600} truncate>
                        {p.name}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {p.partner ? tx('Partner') : tx('Opponent')}
                      </Text>
                    </Stack>
                    <Group gap={6} wrap="nowrap" miw={0}>
                      <Text
                        size="sm"
                        ff="monospace"
                        ta="right"
                        style={{ overflowWrap: 'anywhere' }}
                      >
                        {copied ? tx('Copied') : p.contact}
                      </Text>
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </Group>
                  </Group>
                </UnstyledButton>
              )}
            </CopyButton>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
