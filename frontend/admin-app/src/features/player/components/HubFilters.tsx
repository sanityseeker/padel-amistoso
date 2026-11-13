import { Group, SegmentedControl, Select } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import type { Sport } from '../stats';

// The Hub's filters, at the top of every Hub page so a player sees what the page is narrowed to
// before reading it: the community or club (ratings, leaderboard and history) and, on pages that
// split by sport, padel, tennis or all. Both choices are kept across pages and visits.
export function HubFilters({
  scope,
  scopeOptions,
  onScope,
  sport,
  fallbackSport,
  sports,
  onSport,
  showSport,
  withAll,
}: {
  scope: string;
  scopeOptions: { value: string; label: string }[];
  onScope: (scope: string) => void;
  /** The saved filter. */
  sport: Sport | 'all';
  /** Highlighted on a page without All (Ratings) while the saved filter is All. */
  fallbackSport: Sport;
  sports: Sport[];
  onSport: (sport: Sport | 'all') => void;
  showSport: boolean;
  /** Offer All as the first option (not on Ratings, which shows one sport at a time). */
  withAll: boolean;
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
          value={sport === 'all' && !withAll ? fallbackSport : sport}
          onChange={(v) => onSport(v as Sport | 'all')}
          aria-label={tx('Sport')}
          data={[
            ...(withAll ? [{ value: 'all', label: tx('All') }] : []),
            { value: 'padel', label: tx('Padel') },
            { value: 'tennis', label: tx('Tennis') },
          ]}
        />
      )}
    </Group>
  );
}
