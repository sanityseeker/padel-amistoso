import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  MultiSelect,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { ResponsiveSheet } from './ResponsiveSheet';

export interface PayableTeammate {
  player_id: string;
  player_name: string;
}

// "I also paid for": the other players of the same event whose payment is still open. Shown only
// when there is someone to pick; the server checks every id again. Players can search in the field
// or open the full list and tick names.
export function AlsoPaidFor({
  players,
  value,
  onChange,
}: {
  players: PayableTeammate[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  useLocale();
  const [browsing, setBrowsing] = useState(false);
  if (!players.length) return null;
  return (
    <Stack gap={4}>
      <MultiSelect
        label={tx('Also paid for')}
        placeholder={tx('Choose players')}
        description={tx('Their payment is reported too. The organizer confirms each one.')}
        searchable
        clearable
        nothingFoundMessage={tx('No players found')}
        data={players.map((p) => ({ value: p.player_id, label: p.player_name }))}
        value={value}
        onChange={onChange}
      />
      <Group justify="flex-end">
        <Button variant="subtle" size="compact-sm" onClick={() => setBrowsing(true)}>
          {tx('Browse all players')}
        </Button>
      </Group>
      <BrowseSheet
        opened={browsing}
        onClose={() => setBrowsing(false)}
        players={players}
        value={value}
        onChange={onChange}
      />
    </Stack>
  );
}

function BrowseSheet({
  opened,
  onClose,
  players,
  value,
  onChange,
}: {
  opened: boolean;
  onClose: () => void;
  players: PayableTeammate[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [q, setQ] = useState('');
  const sorted = useMemo(
    () => [...players].sort((a, b) => a.player_name.localeCompare(b.player_name)),
    [players],
  );
  const needle = q.trim().toLocaleLowerCase();
  const list = needle
    ? sorted.filter((p) => p.player_name.toLocaleLowerCase().includes(needle))
    : sorted;
  const picked = new Set(value);
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={tx('Also paid for')}>
      <Stack>
        <TextInput
          label={tx('Search players')}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <ScrollArea.Autosize mah={360}>
          <Stack gap={8}>
            {list.map((p) => (
              <Checkbox
                key={p.player_id}
                label={p.player_name}
                checked={picked.has(p.player_id)}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  onChange(on ? [...value, p.player_id] : value.filter((id) => id !== p.player_id));
                }}
              />
            ))}
            {!list.length && (
              <Text size="sm" c="dimmed">
                {tx('No players found')}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {tx('{n} selected', { n: value.length })}
          </Text>
          <Button onClick={onClose}>{tx('Done')}</Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
