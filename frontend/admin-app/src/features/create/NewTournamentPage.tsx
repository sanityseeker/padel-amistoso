import { useMemo } from 'react';
import { Group, Paper, Radio, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail } from '../../types';
import { PageHeader, TopBarAction } from '../../ui';
import { useLayoutMode } from '../../shell/layout';
import { useDemoAccount } from '../../useDemoAccount';
import { InfoSectionButton } from '../info/EloInfo';
import { CreateLobby } from '../lobbies/CreateLobby';
import classes from './Create.module.css';
import { TournamentForm, type TournamentKind } from './TournamentForm';

const FORMATS: { value: TournamentKind | 'lobby'; label: string; hint: string }[] = [
  {
    value: 'group_playoff',
    label: 'Group + Play-off',
    hint: 'Round-robin groups, then a knockout bracket for the best.',
  },
  {
    value: 'mexicano',
    label: 'Mexicano + Play-offs',
    hint: 'New pairings every round from the standings, then optional play-offs.',
  },
  { value: 'playoff', label: 'Play-offs', hint: 'A knockout bracket from the first match.' },
  { value: 'lobby', label: 'Lobby', hint: 'A sign-up page; convert it into a tournament later.' },
];

// New tournament, new lobby, and (with ?from=<lobby>) convert a lobby. The format is a row of
// selectable tiles; the form under it adapts to the choice.
export function NewTournamentPage() {
  useLocale();
  const { mode } = useLayoutMode();
  const demo = useDemoAccount();
  const [params, setParams] = useSearchParams();
  const requested = params.get('type');
  const from = params.get('from');
  const kind = FORMATS.some((f) => f.value === requested && !(demo && f.value === 'lobby'))
    ? (requested as TournamentKind | 'lobby')
    : 'group_playoff';
  const lobby = useQuery({
    queryKey: ['admin', 'lobby', from, 'detail'],
    queryFn: () => api<LobbyDetail>(`/registrations/${from}`),
    enabled: !!from,
  });
  // A demo sandbox cannot run sign-up lobbies (the server refuses them), so the tile is not offered.
  const formats = from || demo ? FORMATS.filter((f) => f.value !== 'lobby') : FORMATS;
  const current = from && kind === 'lobby' ? 'group_playoff' : kind;
  const infoLabel = tx('About this format');
  const infoButton = useMemo(
    () => (
      <InfoSectionButton
        id="info-formats"
        label={infoLabel}
        size={mode === 'phone' ? 'touch' : undefined}
      />
    ),
    [infoLabel, mode],
  );
  return (
    <>
      <TopBarAction>{mode === 'phone' ? infoButton : null}</TopBarAction>
      <Stack gap="lg">
        <PageHeader
          compactActions
          actions={mode === 'phone' ? undefined : infoButton}
          title={from ? tx('Convert to tournament') : tx('New Tournament')}
          keepDescription
          description={
            from && lobby.data
              ? tx('Players come from «{name}».', { name: lobby.data.name })
              : undefined
          }
        />
        <Radio.Group
          value={current}
          onChange={(v) => {
            const next = new URLSearchParams(params);
            next.set('type', v);
            setParams(next, { replace: true });
          }}
          aria-label={tx('Format')}
        >
          <SimpleGrid cols={{ base: 1, xs: 2, lg: formats.length }} spacing="sm">
            {formats.map((f) => (
              <Radio.Card
                key={f.value}
                value={f.value}
                radius="lg"
                className={classes.tile}
                aria-label={tx(f.label)}
                p={0}
              >
                <Paper className={classes.tile} p="md" withBorder={false}>
                  <Group wrap="nowrap" align="flex-start" gap="sm">
                    <Radio.Indicator />
                    <Stack gap={4}>
                      <Text fw={700}>{tx(f.label)}</Text>
                      <Text size="xs" c="dimmed">
                        {tx(f.hint)}
                      </Text>
                    </Stack>
                  </Group>
                </Paper>
              </Radio.Card>
            ))}
          </SimpleGrid>
        </Radio.Group>
        {current === 'lobby' ? (
          <CreateLobby />
        ) : from && lobby.isPending ? (
          <Loading />
        ) : (
          <TournamentForm
            key={`${current}-${from ?? ''}`}
            kind={current}
            lobby={from && lobby.data ? lobby.data : undefined}
          />
        )}
      </Stack>
    </>
  );
}
