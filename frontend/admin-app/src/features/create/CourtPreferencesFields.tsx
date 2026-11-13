import { MultiSelect, Stack, Switch, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';

export type CourtPreferences = Record<string, string[]>;

export interface CourtScope {
  /** Group name, or the Espejo side `winners` / `losers`. */
  key: string;
  label: string;
}

/** Drop scopes that are not shown and names of courts that no longer exist. */
export function cleanPreferences(
  value: CourtPreferences,
  scopes: CourtScope[],
  courtNames: string[],
): CourtPreferences {
  const out: CourtPreferences = {};
  for (const { key } of scopes) {
    const names = (value[key] ?? []).filter((n) => courtNames.includes(n));
    if (names.length) out[key] = names;
  }
  return out;
}

/** The two Espejo brackets: Gold (`winners`) and Silver (`losers`), as everywhere else. */
export function espejoScopes(): CourtScope[] {
  return [
    { key: 'winners', label: tx('Gold') },
    { key: 'losers', label: tx('Silver') },
  ];
}

// Optional preferred courts per group or per Espejo bracket. Preferred, not reserved: a match takes one of
// its own courts first and borrows a free one when they are busy.
export function CourtPreferencesFields({
  enabled,
  onEnabledChange,
  scopes,
  courtNames,
  value,
  onChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  scopes: CourtScope[];
  courtNames: string[];
  value: CourtPreferences;
  onChange: (value: CourtPreferences) => void;
}) {
  useLocale();
  if (!scopes.length || courtNames.length < 2) return null;
  const options = [...new Set(courtNames)];
  return (
    <Stack gap="xs">
      <Switch
        label={tx('Courts per group or bracket')}
        description={tx(
          'Matches use their own courts first. When those are busy, they use any free court.',
        )}
        checked={enabled}
        onChange={(e) => onEnabledChange(e.currentTarget.checked)}
      />
      {enabled && (
        <Stack gap="xs">
          {scopes.map((scope) => (
            <MultiSelect
              key={scope.key}
              label={scope.label}
              placeholder={(value[scope.key] ?? []).length ? undefined : tx('Any court')}
              data={options}
              value={(value[scope.key] ?? []).filter((n) => options.includes(n))}
              onChange={(names) => onChange({ ...value, [scope.key]: names })}
              clearable
              searchable={false}
            />
          ))}
          <Text size="xs" c="dimmed">
            {tx('A court that no group or bracket picks is shared by all.')}
          </Text>
        </Stack>
      )}
    </Stack>
  );
}
