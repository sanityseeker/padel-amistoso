import {
  ActionIcon,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconWand, IconX } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { clean, newTeam, teamLabel, type Team } from './rules';

// Fixed teams, one card per team: the members, plus an optional team name. Without a `pool` the members
// are typed (create). With a `pool` (convert a lobby) each member is picked from the selected
// registrants and one person can sit in one slot only; "Auto pair" deals the pool out two by two.
export function TeamBuilder({
  teams,
  onChange,
  pool,
  size = 2,
}: {
  teams: Team[];
  onChange: (teams: Team[]) => void;
  pool?: string[];
  size?: number;
}) {
  useLocale();
  const patch = (id: number, change: Partial<Team>) =>
    onChange(teams.map((team) => (team.id === id ? { ...team, ...change } : team)));
  const taken = new Set(teams.flatMap((team) => team.members.map(clean)).filter(Boolean));
  const unassigned = (pool ?? []).filter((name) => !taken.has(name));
  const autoPair = () => {
    // Teams that hold someone outside the pool (typed in by hand) stay; everyone else is dealt again.
    const inPool = new Set(pool ?? []);
    const manual = teams.filter((team) =>
      team.members.some((m) => clean(m) && !inPool.has(clean(m))),
    );
    const dealt: Team[] = [];
    const names = pool ?? [];
    for (let i = 0; i + size - 1 < names.length; i += size)
      dealt.push(newTeam(names.slice(i, i + size)));
    onChange([...dealt, ...manual]);
  };
  return (
    <Stack gap="sm">
      {teams.map((team, index) => (
        <Paper key={team.id} p="sm" variant="row" data-testid="team-row">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={700} c="dimmed">
                {tx('Team {n}', { n: index + 1 })}
              </Text>
              <ActionIcon
                aria-label={tx('Remove team {n}', { n: index + 1 })}
                disabled={teams.length <= 1}
                onClick={() => onChange(teams.filter((t) => t.id !== team.id))}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
            <SimpleGrid cols={{ base: 1, xs: size + 1 }} spacing="xs">
              {team.members.map((member, slot) =>
                pool ? (
                  <Select
                    key={slot}
                    aria-label={tx('Team {n}, player {p}', { n: index + 1, p: slot + 1 })}
                    placeholder={tx('Player {n}', { n: slot + 1 })}
                    searchable
                    clearable
                    data={pool.map((name) => ({
                      value: name,
                      label: name,
                      disabled: taken.has(name) && name !== member,
                    }))}
                    value={member || null}
                    onChange={(v) =>
                      patch(team.id, {
                        members: team.members.map((m, i) => (i === slot ? (v ?? '') : m)),
                      })
                    }
                  />
                ) : (
                  <TextInput
                    key={slot}
                    aria-label={tx('Team {n}, player {p}', { n: index + 1, p: slot + 1 })}
                    placeholder={tx('Player {n}', { n: slot + 1 })}
                    value={member}
                    onChange={(e) =>
                      patch(team.id, {
                        members: team.members.map((m, i) =>
                          i === slot ? e.currentTarget.value : m,
                        ),
                      })
                    }
                  />
                ),
              )}
              <TextInput
                aria-label={tx('Team {n} name', { n: index + 1 })}
                placeholder={teamLabel({ ...team, name: '' }) || tx('Team name (optional)')}
                value={team.name}
                onChange={(e) => patch(team.id, { name: e.currentTarget.value })}
              />
            </SimpleGrid>
          </Stack>
        </Paper>
      ))}
      {pool && unassigned.length > 0 && (
        <Text size="sm" c="dimmed">
          {tx('Unassigned')}: {unassigned.join(', ')}
        </Text>
      )}
      <Group gap="xs">
        <Button
          variant="light"
          leftSection={<IconPlus size={16} />}
          onClick={() =>
            onChange([
              ...teams,
              newTeam(
                pool
                  ? Array.from({ length: size }, (_, i) => unassigned[i] ?? '')
                  : Array(size).fill(''),
              ),
            ])
          }
        >
          {tx('Add team')}
        </Button>
        {pool && (
          <Button variant="default" leftSection={<IconWand size={16} />} onClick={autoPair}>
            {tx('Auto pair')}
          </Button>
        )}
      </Group>
    </Stack>
  );
}
