import { useState } from 'react';
import {
  Accordion,
  Button,
  Group,
  Input,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconUsersPlus } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { NameListField } from './NameListField';
import { RosterPicker, type PickedPlayer } from './RosterPicker';
import { newTeam, clean, DEFAULT_STRENGTH, type EntryMode, type Seeding, type Team } from './rules';
import { TeamBuilder } from './TeamBuilder';
import { useDemoAccount } from '../../useDemoAccount';

/** The seeding choice and the ratings it prefills, keyed by player name. */
export interface SeedingState {
  mode: Seeding;
  onMode: (mode: Seeding) => void;
  ratings: Record<string, number>;
}

export interface PlayerMeta {
  email?: string;
  contact?: string;
  profile_id?: string;
  strength?: number;
}

// Who plays: the Individual / Team switch, then either one name per line or the team builder, the
// "known players" picker, and the optional contact and strength details per player.
export function PlayersFields({
  choice,
  entry,
  onEntry,
  builder,
  text,
  onText,
  teams,
  onTeams,
  playerNames,
  meta,
  onMeta,
  count,
  sport,
  clubId,
  hint,
  seeding,
  details = true,
}: {
  choice: boolean;
  entry: EntryMode;
  onEntry: (mode: EntryMode) => void;
  builder: boolean;
  text: string;
  onText: (text: string) => void;
  teams: Team[];
  onTeams: (teams: Team[]) => void;
  /** Every person entered, whichever way (the keys of `meta`). */
  playerNames: string[];
  meta: Record<string, PlayerMeta>;
  onMeta: (next: Record<string, PlayerMeta>) => void;
  /** Entries (players or teams) counted for the heading. */
  count: number;
  sport: string;
  clubId: string | null;
  hint: string;
  seeding: SeedingState;
  details?: boolean;
}) {
  useLocale();
  const [picking, setPicking] = useState(false);
  const taken = new Set(playerNames.map((n) => n.toLowerCase()));

  const addPicked = (picked: PickedPlayer[]) => {
    const fresh = picked.filter((p) => !taken.has(p.name.toLowerCase()));
    if (builder) {
      // Fill empty slots first, then add teams of two.
      const next = teams.map((team) => ({ ...team, members: [...team.members] }));
      const queue = fresh.map((p) => p.name);
      for (const team of next)
        for (let i = 0; i < team.members.length && queue.length; i++)
          if (!clean(team.members[i]!)) team.members[i] = queue.shift()!;
      while (queue.length) next.push(newTeam([queue.shift()!, queue.shift() ?? '']));
      onTeams(next);
    } else onText([...playerNames, ...fresh.map((p) => p.name)].join('\n'));
    const nextMeta = { ...meta };
    for (const p of fresh)
      nextMeta[p.name] = { ...nextMeta[p.name], email: p.email, profile_id: p.profile_id };
    onMeta(nextMeta);
  };

  return (
    <Stack>
      {choice && (
        <SegmentedControl
          aria-label={tx('Entries')}
          value={entry}
          onChange={(v) => onEntry(v as EntryMode)}
          data={[
            { value: 'individual', label: tx('Individual') },
            { value: 'team', label: tx('Team') },
          ]}
        />
      )}
      {builder ? (
        <TeamBuilder teams={teams} onChange={onTeams} />
      ) : (
        <NameListField
          label={tx('Players')}
          description={hint}
          placeholder={tx('Ana Garcia\nCarlos Lopez\nLucia Martin\nPablo Ruiz')}
          minRows={5}
          value={text}
          onChange={onText}
          itemLabel={(n) => tx('Player {n}', { n })}
          itemPlaceholder={(n) => tx('Player {n}', { n })}
          removeLabel={(n) => tx('Remove player {n}', { n })}
          addLabel={tx('Add player')}
        />
      )}
      <Group justify="space-between">
        <Button
          variant="light"
          leftSection={<IconUsersPlus size={16} />}
          onClick={() => setPicking(true)}
        >
          {tx('Add known players')}
        </Button>
        <Text size="sm" c="dimmed">
          {builder ? tx('{n} teams', { n: count }) : tx('{n} players', { n: count })}
        </Text>
      </Group>
      {details && (
        <PlayerDetails names={playerNames} meta={meta} onMeta={onMeta} seeding={seeding} />
      )}
      {picking && (
        <RosterPicker
          clubId={clubId}
          sport={sport}
          taken={taken}
          onAdd={addPicked}
          onClose={() => setPicking(false)}
        />
      )}
    </Stack>
  );
}

// The seeding choice, then optional contact details and a starting strength per person. With ELO
// seeding a linked player's strength shows their rating until it is edited (clearing the field brings
// the rating back). `strengthOnly` is for converting a lobby, whose registrants already carry their
// contact details.
export function PlayerDetails({
  names,
  meta,
  onMeta,
  seeding,
  strengthOnly = false,
}: {
  names: string[];
  meta: Record<string, PlayerMeta>;
  onMeta: (next: Record<string, PlayerMeta>) => void;
  seeding: SeedingState;
  strengthOnly?: boolean;
}) {
  useLocale();
  const demo = useDemoAccount();
  const set = (name: string, patch: PlayerMeta) =>
    onMeta({ ...meta, [name]: { ...meta[name], ...patch } });
  if (!names.length) return null;
  const withStrength = seeding.mode !== 'none';
  const prefilled = (n: string) =>
    seeding.mode === 'elo' && meta[n]?.strength === undefined ? seeding.ratings[n] : undefined;
  return (
    <Stack gap="sm">
      <Input.Wrapper
        label={tx('Seeding')}
        description={
          seeding.mode === 'elo'
            ? tx(
                'Linked players start from their club or community rating. Edit a value to override it. Everyone else starts at 1000.',
              )
            : seeding.mode === 'manual'
              ? tx(
                  'Only the strengths you enter count, on the rating scale. Blank players start at 1000.',
                )
              : tx('No seeding: ratings and strengths are ignored.')
        }
      >
        <SegmentedControl
          mt={4}
          fullWidth
          aria-label={tx('Seeding')}
          value={seeding.mode}
          onChange={(v) => seeding.onMode(v as Seeding)}
          data={[
            { value: 'elo', label: tx('By rating') },
            { value: 'manual', label: tx('Manual') },
            { value: 'none', label: tx('No seeding') },
          ]}
        />
      </Input.Wrapper>
      {(withStrength || !strengthOnly) && (
        <Accordion variant="contained" radius="lg">
          <Accordion.Item value="details">
            <Accordion.Control>
              {strengthOnly
                ? tx('Starting strength (optional)')
                : withStrength
                  ? tx('Contact details and starting strength (optional)')
                  : tx('Contact details (optional)')}
            </Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                {names.map((n) => (
                  <SimpleGrid
                    key={n}
                    cols={{
                      base: 1,
                      sm: strengthOnly ? 2 : withStrength ? 4 : 3,
                    }}
                    spacing="xs"
                  >
                    <Text size="sm" fw={600} pt={6}>
                      {n}
                      {meta[n]?.profile_id && (
                        <Text span size="xs" c="dimmed">
                          {' '}
                          · {tx('Linked to a profile')}
                        </Text>
                      )}
                      {prefilled(n) !== undefined && (
                        <Text span size="xs" c="dimmed">
                          {' '}
                          · {tx('Rating')}
                        </Text>
                      )}
                    </Text>
                    {!strengthOnly && (
                      <>
                        <TextInput
                          aria-label={tx('Email for {name}', { name: n })}
                          placeholder={tx('Email')}
                          disabled={demo}
                          title={demo ? tx('Not available in demo mode') : undefined}
                          type="email"
                          value={meta[n]?.email ?? ''}
                          onChange={(e) => set(n, { email: e.currentTarget.value })}
                        />
                        <TextInput
                          aria-label={tx('Contact for {name}', { name: n })}
                          placeholder={tx('Contact')}
                          disabled={demo}
                          title={demo ? tx('Not available in demo mode') : undefined}
                          value={meta[n]?.contact ?? ''}
                          onChange={(e) => set(n, { contact: e.currentTarget.value })}
                        />
                      </>
                    )}
                    {withStrength && (
                      <NumberInput
                        aria-label={tx('Starting strength for {name}', { name: n })}
                        placeholder={String(DEFAULT_STRENGTH)}
                        min={0}
                        value={meta[n]?.strength ?? prefilled(n) ?? ''}
                        onChange={(v) => set(n, { strength: v === '' ? undefined : Number(v) })}
                      />
                    )}
                  </SimpleGrid>
                ))}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  );
}
