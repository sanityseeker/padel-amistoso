import { t as tx, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { useNavigate } from 'react-router-dom';
import { api, write } from '../api';
import { useOverview } from '../components';
import { useAuth } from '../auth';
import type { Season } from '../types';
export function ScopeFields({
  community,
  setCommunity,
  club,
  setClub,
  season,
  setSeason,
}: {
  community: string;
  setCommunity: (value: string) => void;
  club: string | null;
  setClub: (value: string | null) => void;
  season?: string | null;
  setSeason?: (value: string | null) => void;
}) {
  useLocale();
  const { communities, clubs } = useOverview();
  const seasons = useQuery({
    queryKey: ['seasons', club],
    queryFn: () => api<Season[]>(`/clubs/${club}/seasons`),
    enabled: !!club,
  });
  return (
    <>
      <Select
        label={tx('Community')}
        required
        data={(communities.data || []).map((c) => ({
          value: c.id,
          label: c.name,
        }))}
        value={community}
        onChange={(v) => {
          setCommunity(v || 'open');
          setClub(null);
          setSeason?.(null);
        }}
      />
      <Select
        label={tx('Club')}
        placeholder={tx('No club')}
        clearable
        data={(clubs.data || [])
          .filter((c) => c.community_id === community)
          .map((c) => ({
            value: c.id,
            label: c.name,
          }))}
        value={club}
        onChange={(v) => {
          setClub(v);
          setSeason?.(null);
        }}
      />
      {setSeason && club && (
        <Select
          label={tx('Season')}
          placeholder={tx('No season')}
          clearable
          data={(seasons.data || [])
            .filter((s) => s.active)
            .map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          value={season}
          onChange={setSeason}
        />
      )}
    </>
  );
}
export function CreateTournament({
  opened,
  close,
  embedded = false,
  initialType = 'mexicano',
}: {
  opened: boolean;
  close: () => void;
  embedded?: boolean;
  initialType?: string;
}) {
  useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [type, setType] = useState(initialType);
  const [sport, setSport] = useState('padel');
  const [players, setPlayers] = useState('');
  const [courts, setCourts] = useState('Court 1\nCourt 2');
  const [rounds, setRounds] = useState<number | string>(6);
  const [points, setPoints] = useState<number | string>(32);
  const [groups, setGroups] = useState<number | string>(2);
  const [top, setTop] = useState<number | string>(2);
  const [community, setCommunity] = useState(user?.default_community_id || 'open');
  const [club, setClub] = useState<string | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(true);
  const [doubleElimination, setDoubleElimination] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const names = players
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean);
      const courtNames = courts
        .split('\n')
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length < (sport === 'padel' && type !== 'playoff' ? 4 : 2))
        throw new Error('Add enough players: at least four for padel doubles or two for singles.');
      if (new Set(names.map((n) => n.toLowerCase())).size !== names.length)
        throw new Error('Player names must be unique.');
      if (!courtNames.length) throw new Error('Add at least one court.');
      const body = {
        name: name.trim(),
        sport,
        community_id: community,
        club_id: club,
        season_id: season,
        court_names: courtNames,
        public: isPublic,
        team_mode: false,
        double_elimination: doubleElimination,
      };
      return write<{
        id: string;
      }>(`/tournaments/${type === 'group_playoff' ? 'group-playoff' : type}`, {
        ...body,
        ...(type === 'playoff'
          ? {
              participant_names: names,
            }
          : {
              player_names: names,
            }),
        ...(type === 'mexicano'
          ? {
              num_rounds: Number(rounds),
              total_points_per_match: Number(points),
            }
          : {}),
        ...(type === 'group_playoff'
          ? {
              num_groups: Number(groups),
              top_per_group: Number(top),
            }
          : {}),
      });
    },
    onSuccess: (t) => {
      void client.invalidateQueries({
        queryKey: ['tournaments'],
      });
      close();
      setName('');
      setPlayers('');
      navigate(`/tournaments/${t.id}`);
      notifications.show({
        message: tx('Tournament created'),
        color: 'green',
      });
    },
  });
  useEffect(() => {
    if (opened) mutation.reset();
  }, [opened]);
  const content = (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Stack>
          {mutation.error && <Alert color="red">{tx(mutation.error.message)}</Alert>}
          <TextInput
            label={tx('Tournament name')}
            placeholder={tx('Friday night padel')}
            required
            maxLength={255}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <SimpleGrid cols={2}>
            <Select
              label={tx('Format')}
              allowDeselect={false}
              data={[
                {
                  value: 'mexicano',
                  label: tx('Mexicano'),
                },
                {
                  value: 'group_playoff',
                  label: tx('Group + Play-off'),
                },
                {
                  value: 'playoff',
                  label: tx('Direct Play-off'),
                },
              ]}
              value={type}
              onChange={(v) => setType(v!)}
            />
            <Select
              label={tx('Sport')}
              allowDeselect={false}
              data={[
                {
                  value: 'padel',
                  label: tx('Padel'),
                },
                {
                  value: 'tennis',
                  label: tx('Tennis'),
                },
              ]}
              value={sport}
              onChange={(v) => setSport(v!)}
            />
          </SimpleGrid>
          <Textarea
            label={tx('Players')}
            description={tx(
              'One name per line. Individual entries; doubles are paired by the tournament engine.',
            )}
            placeholder={tx('Ana Garcia\nCarlos Lopez\nLucia Martin\nPablo Ruiz')}
            autosize
            minRows={5}
            required
            value={players}
            onChange={(e) => setPlayers(e.currentTarget.value)}
          />
          <Textarea
            label={tx('Courts')}
            description={tx('One court per line')}
            minRows={2}
            required
            value={courts}
            onChange={(e) => setCourts(e.currentTarget.value)}
          />
          {type === 'mexicano' && (
            <SimpleGrid cols={2}>
              <NumberInput
                label={tx('Rounds')}
                min={1}
                max={100}
                allowDecimal={false}
                required
                value={rounds}
                onChange={setRounds}
              />
              <NumberInput
                label={tx('Points per match')}
                min={1}
                max={1000}
                allowDecimal={false}
                required
                value={points}
                onChange={setPoints}
              />
            </SimpleGrid>
          )}
          {type === 'group_playoff' && (
            <SimpleGrid cols={2}>
              <NumberInput
                label={tx('Groups')}
                min={1}
                max={32}
                allowDecimal={false}
                required
                value={groups}
                onChange={setGroups}
              />
              <NumberInput
                label={tx('Qualifiers per group')}
                min={1}
                allowDecimal={false}
                required
                value={top}
                onChange={setTop}
              />
            </SimpleGrid>
          )}
          {type !== 'mexicano' && (
            <Switch
              label={tx('Double elimination')}
              checked={doubleElimination}
              onChange={(e) => setDoubleElimination(e.currentTarget.checked)}
            />
          )}
          <ScopeFields
            community={community}
            setCommunity={setCommunity}
            club={club}
            setClub={setClub}
            season={season}
            setSeason={setSeason}
          />
          <Switch
            label={tx('List publicly')}
            checked={isPublic}
            onChange={(e) => setPublic(e.currentTarget.checked)}
          />
          <Text size="xs" c="dimmed">
            {tx(
              'Fixed teams, seeded brackets, and advanced pairing options are available in Advanced admin.',
            )}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              {tx('Cancel')}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {tx('Create tournament')}
            </Button>
          </Group>
        </Stack>
      </form>
    </>
  );
  return embedded ? (
    content
  ) : (
    <Modal opened={opened} onClose={close} title={tx('Create tournament')} size="lg" centered>
      {content}
    </Modal>
  );
}
