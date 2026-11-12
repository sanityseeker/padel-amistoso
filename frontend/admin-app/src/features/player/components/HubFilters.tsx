import { Group, SegmentedControl, Select } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import type { Sport } from '../stats';

// The Hub's filters, at the top of every Hub page so a player sees what the page is narrowed to
// before reading it: the community or club (ratings, leaderboard and history) and, on pages that
// split by sport, padel or tennis. Both choices are kept across pages and visits.
export function HubFilters({
  scope,
  scopeOptions,
  onScope,
  sport,
  sports,
  onSport,
  showSport,
}: {
  scope: string;
  scopeOptions: { value: string; label: string }[];
  onScope: (scope: string) => void;
  sport: Sport;
  sports: Sport[];
  onSport: (sport: Sport) => void;
  showSport: boolean;
}) {
  useLocale();
  const withScope = scopeOptions.length > 1;
  const withSport = showSport && sports.length > 1;
  if (!withScope && !withSport) return null;
  return (
    <Group justify="space-between" gap="xs" data-testid="hub-filters">
      {withScope ? (
        <Select
          aria-label={tx('Player stats scope')}
          data={scopeOptions}
          value={scope}
          allowDeselect={false}
          onChange={(v) => onScope(v ?? '')}
          w={{ base: '100%', xs: 240 }}
        />
      ) : (
        <span />
      )}
      {withSport && (
        <SegmentedControl
          value={sport}
          onChange={(v) => onSport(v as Sport)}
          aria-label={tx('Rating sport')}
          data={[
            { value: 'padel', label: tx('Padel') },
            { value: 'tennis', label: tx('Tennis') },
          ]}
        />
      )}
    </Group>
  );
}
