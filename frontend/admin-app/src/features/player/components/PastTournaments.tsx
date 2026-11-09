import { Anchor, Badge, Group, Stack, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { formatType } from '../../../api';
import type { Entry } from '../../../player/types';
import { EventRow } from '../../../ui';
import { entryPath } from '../context';

const SHOWN = 3;

/** Finished tournaments you can still open: the newest few of "My events > Finished". */
export const pastOf = (entries: Entry[]) =>
  entries.filter(
    (e) => e.entity_type === 'tournament' && e.status === 'finished' && !e.entity_deleted,
  );

// The Hub's Past section. Each row opens the same page as an active card (read-only, with the
// Finished banner); the full list with unlink lives on My events.
export function PastTournaments({ entries }: { entries: Entry[] }) {
  useLocale();
  const past = pastOf(entries);
  if (!past.length) return null;
  return (
    <Stack gap="sm" component="section" aria-labelledby="hub-past">
      <Group justify="space-between">
        <Title order={2} id="hub-past" size="h3">
          {tx('Past tournaments')}
        </Title>
        <Anchor component={Link} to="/player/matches?tab=finished" size="sm">
          {tx('All past events')}
        </Anchor>
      </Group>
      <Stack gap="xs">
        {past.slice(0, SHOWN).map((entry) => (
          <EventRow
            key={entry.entity_id}
            testId="past-tournament"
            to={entryPath(entry)}
            sport={entry.sport}
            title={entry.entity_name}
            meta={[
              entry.tournament_type ? formatType(entry.tournament_type) : '',
              tx(entry.sport === 'tennis' ? 'Tennis' : 'Padel'),
            ]
              .filter(Boolean)
              .join(' · ')}
            badges={
              <>
                {entry.rank ? (
                  <Badge size="sm" color="gray">
                    #{entry.rank}
                  </Badge>
                ) : null}
                <Badge size="sm" variant="light">
                  {entry.wins} {tx('wins ·')} {entry.losses} {tx('losses')}
                </Badge>
              </>
            }
          />
        ))}
      </Stack>
    </Stack>
  );
}
