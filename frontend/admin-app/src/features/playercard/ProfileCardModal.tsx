import { Loader, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';
import { ResponsiveSheet } from '../../ui';
import { CardError, scopeLabel, ScopedCardBody, useScopedCard } from './ScopedCard';
import type { CardSource } from './source';
import { BackButton, useTrail } from './trail';

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
  // A partner's or opponent's name opens their card here, in the same scope.
  const trail = useTrail<string>(target);
  const profileId = trail.top ?? target?.profileId;
  const card = useScopedCard(
    source,
    ['profile', profileId, target?.query],
    target && profileId ? `/player-cards/${encodeURIComponent(profileId)}${target.query}` : null,
  );
  const data = card.data;
  return (
    <ResponsiveSheet
      opened={!!target}
      onClose={onClose}
      size="lg"
      title={data?.name ?? tx('Loading')}
    >
      {trail.top && <BackButton onClick={trail.back} />}
      {card.isPending && <Loader aria-label={tx('Loading')} />}
      {card.error && <CardError error={card.error} />}
      {data && (
        <Stack gap="md" data-testid="profile-player-card">
          <Text variant="eyebrow" data-testid="card-scope-label">
            {scopeLabel(data.scope)}
          </Text>
          <ScopedCardBody
            card={data}
            onProfile={(id) => id !== data.profile_id && trail.open(id)}
          />
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
