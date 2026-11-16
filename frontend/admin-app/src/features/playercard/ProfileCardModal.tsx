import { Loader, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';
import { ResponsiveSheet } from '../../ui';
import { CardError, scopeLabel, ScopedCardBody, useScopedCard } from './ScopedCard';
import type { CardSource } from './source';

/** A profile to show and the scope query of the board it came from (`?club_id=...&sport=...`). */
export interface ProfileCardTarget {
  profileId: string;
  query: string;
}

// The card of a profile opened from a leaderboard, a rating history or the people a player met. The
// scope is the board's own (the Hub's picked club or community, the club page's club and season), so
// the numbers agree with the row that was tapped; there is no scope switch here.
export function ProfileCardModal({
  target,
  source,
  onClose,
}: {
  target: ProfileCardTarget | null;
  source: CardSource;
  onClose: () => void;
}) {
  useLocale();
  const card = useScopedCard(
    source,
    ['profile', target?.profileId, target?.query],
    target ? `/player-cards/${encodeURIComponent(target.profileId)}${target.query}` : null,
  );
  const data = card.data;
  return (
    <ResponsiveSheet
      opened={!!target}
      onClose={onClose}
      size="lg"
      title={data?.name ?? tx('Loading')}
    >
      {card.isPending && <Loader aria-label={tx('Loading')} />}
      {card.error && <CardError error={card.error} />}
      {data && (
        <Stack gap="md" data-testid="profile-player-card">
          <Text variant="eyebrow" data-testid="card-scope-label">
            {scopeLabel(data.scope)}
          </Text>
          <ScopedCardBody card={data} />
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
