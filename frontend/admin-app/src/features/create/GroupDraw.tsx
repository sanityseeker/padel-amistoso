import { Button, Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { IconArrowsExchange, IconDice3, IconX } from '@tabler/icons-react';
import { OverflowMenu } from '../../ui/OverflowMenu';
import { t as tx, useLocale } from '../../i18n';
import { drawGroups, groupMatches, groupRoundMatches, type GroupDraw as Draw } from './rules';
import { StatusBadge } from '../../ui/StatusBadge';

// The seeded group draw, previewed before the tournament exists. Strengths snake-draft the players;
// without them the draw is random. Every player can be moved to another group, or the whole draw
// shuffled. The result is sent as `group_assignments` (group name to the players it holds).
export function GroupDraw({
  names,
  groupNames,
  strengths,
  fixedSides,
  value,
  onChange,
}: {
  names: string[];
  groupNames: string[];
  strengths: Record<string, number> | null;
  fixedSides: boolean;
  value: Draw[] | null;
  onChange: (draw: Draw[] | null) => void;
}) {
  useLocale();
  if (groupNames.length < 2)
    return (
      <Text size="sm" c="dimmed">
        {tx('Add a second group to preview a draw.')}
      </Text>
    );
  if (!value)
    return (
      <Group justify="space-between" align="center" gap="sm">
        <Text size="sm" c="dimmed" maw={420}>
          {tx(
            'Optional. Preview who plays in which group, move players around, or let the tournament deal them out when you create it.',
          )}
        </Text>
        <Button
          variant="light"
          leftSection={<IconDice3 size={16} />}
          disabled={names.length < 2}
          onClick={() => onChange(drawGroups(names, groupNames, strengths))}
        >
          {tx('Preview the draw')}
        </Button>
      </Group>
    );
  const move = (from: number, index: number, to: number) => {
    const next = value.map((g) => ({ ...g, players: [...g.players] }));
    const [player] = next[from]!.players.splice(index, 1);
    if (player) next[to]!.players.push(player);
    onChange(next);
  };
  const total = value.reduce(
    (sum, g) =>
      sum + (fixedSides ? groupMatches(g.players.length) : groupRoundMatches(g.players.length)),
    0,
  );
  return (
    <Stack gap="sm" data-testid="group-draw">
      <SimpleGrid cols={{ base: 1, xs: 2, md: Math.min(4, value.length) }} spacing="sm">
        {value.map((group, gi) => (
          <Paper key={group.name + gi} p="sm" variant="row">
            <Stack gap={4}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{group.name}</Text>
                <StatusBadge>{group.players.length}</StatusBadge>
              </Group>
              {group.players.map((player, pi) => (
                <Group key={player} justify="space-between" wrap="nowrap" gap={4}>
                  <Text size="sm" truncate title={player}>
                    {player}
                    {strengths?.[player] != null && (
                      <Text span size="xs" c="dimmed">
                        {' '}
                        · {strengths[player]}
                      </Text>
                    )}
                  </Text>
                  <OverflowMenu
                    label={tx('Move {name}', { name: player })}
                    icon={<IconArrowsExchange size={14} />}
                    size="sm"
                    items={value.flatMap((other, oi) =>
                      oi === gi
                        ? []
                        : [
                            {
                              key: String(oi),
                              label:
                                value.length === 2
                                  ? tx('Move {name} to {group}', {
                                      name: player,
                                      group: other.name,
                                    })
                                  : tx('Move to {group}', { group: other.name }),
                              icon: <IconArrowsExchange size={14} />,
                              onClick: () => move(gi, pi, oi),
                            },
                          ],
                    )}
                  />
                </Group>
              ))}
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
      <Group justify="space-between" gap="sm">
        <Text size="sm" c="dimmed">
          {fixedSides ? tx('{n} matches', { n: total }) : tx('{n} matches per round', { n: total })}
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            size="xs"
            leftSection={<IconDice3 size={14} />}
            onClick={() =>
              onChange(
                drawGroups(
                  value.flatMap((g) => g.players),
                  value.map((g) => g.name),
                  null,
                ),
              )
            }
          >
            {tx('Shuffle')}
          </Button>
          <Button
            variant="subtle"
            color="gray"
            size="xs"
            leftSection={<IconX size={14} />}
            onClick={() => onChange(null)}
          >
            {tx('Discard the draw')}
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
