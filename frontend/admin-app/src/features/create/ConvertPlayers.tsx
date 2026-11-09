import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Paper,
  Stack,
  TagsInput,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconAlertTriangle, IconClipboardText } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail } from '../../types';
import { registrantAnswer } from '../lobbies/filter';

// Pick who plays from the lobby: every registrant, with a warning for people already in a tournament
// made from this lobby and the answers they gave. Extra players can be typed in (individual entries).
export function ConvertPlayers({
  lobby,
  selected,
  onSelected,
  extras,
  onExtras,
  showExtras,
}: {
  lobby: LobbyDetail;
  selected: Set<string>;
  onSelected: (next: Set<string>) => void;
  extras: string[];
  onExtras: (next: string[]) => void;
  showExtras: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const assigned = new Set(lobby.assigned_player_ids ?? []);
  const linked = new Map((lobby.linked_tournaments ?? []).map((t) => [t.id, t.name]));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelected(next);
  };
  return (
    <Stack gap="sm">
      <Group justify="space-between" gap="xs">
        <Text size="sm" c="dimmed" aria-live="polite">
          {tx('{n} of {total} selected', { n: selected.size, total: lobby.registrants.length })}
        </Text>
        <Group gap="xs">
          <Button
            size="compact-sm"
            variant="default"
            onClick={() => onSelected(new Set(lobby.registrants.map((r) => r.player_id)))}
          >
            {tx('Select all')}
          </Button>
          <Button size="compact-sm" variant="default" onClick={() => onSelected(new Set())}>
            {tx('Deselect all')}
          </Button>
        </Group>
      </Group>
      <Stack gap={6} data-testid="convert-registrants">
        {lobby.registrants.map((r) => {
          const tids = lobby.player_tournament_map?.[r.player_id] ?? [];
          const overlap = assigned.has(r.player_id)
            ? tx('Already in: {tournaments}', {
                tournaments: tids.map((id) => linked.get(id) ?? id).join(', '),
              })
            : null;
          return (
            <Paper key={r.player_id} p="xs" px="sm" variant="row">
              <Group justify="space-between" wrap="nowrap" gap="xs">
                <Checkbox
                  flex={1}
                  checked={selected.has(r.player_id)}
                  onChange={() => toggle(r.player_id)}
                  label={r.player_name}
                />
                {overlap && (
                  <Tooltip label={overlap}>
                    <Badge
                      color="yellow"
                      variant="light"
                      leftSection={<IconAlertTriangle size={12} />}
                      aria-label={overlap}
                    >
                      {tx('In a tournament')}
                    </Badge>
                  </Tooltip>
                )}
                {lobby.questions.length > 0 && (
                  <ActionIcon
                    aria-label={`${tx('Show answers')}: ${r.player_name}`}
                    aria-expanded={open === r.player_id}
                    onClick={() => setOpen(open === r.player_id ? null : r.player_id)}
                  >
                    <IconClipboardText size={16} />
                  </ActionIcon>
                )}
              </Group>
              <Collapse expanded={open === r.player_id}>
                <Stack gap={2} pt="xs" pl={32}>
                  {lobby.questions.map((q) => (
                    <Group key={q.key} gap="xs" wrap="nowrap" align="baseline">
                      <Text size="xs" c="dimmed" w={120} truncate>
                        {q.label}
                      </Text>
                      <Text size="sm">{registrantAnswer(r.answers?.[q.key], q) || '—'}</Text>
                    </Group>
                  ))}
                </Stack>
              </Collapse>
            </Paper>
          );
        })}
      </Stack>
      {showExtras && (
        <TagsInput
          label={tx('Extra players')}
          description={tx('Players who did not register. Type a name and press Enter.')}
          placeholder={tx('Name')}
          value={extras}
          onChange={onExtras}
        />
      )}
    </Stack>
  );
}
