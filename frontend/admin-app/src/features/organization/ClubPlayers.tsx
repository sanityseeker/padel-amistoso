import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Checkbox,
  Code,
  Group,
  Menu,
  NativeSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconDots, IconMail, IconUserPlus } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { ErrorState, Loading, useLobbyList } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { ClubPlayer, Tier } from '../../types';
import {
  ActionBar,
  ActionBarSpacer,
  ConfirmAction,
  EmptyState,
  FormActions,
  MutationError,
  ResponsiveSheet,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { tiersKey } from './ClubTiers';
import { PossibleMembers } from './PossibleMembers';
import { Notice } from '../../ui/Notice';
import { StatusBadge } from '../../ui/StatusBadge';

interface Candidate {
  name: string;
  profile_id: string | null;
  past_player_id: string | null;
  has_hub_profile: boolean;
}
interface BulkResult {
  requested: number;
  sent: number;
  failed: { profile_id: string; reason: string }[];
}
interface DuplicateGroup {
  name: string;
  profiles: ClubPlayer[];
}
interface MergePreview {
  primary: { id: string; name: string; email: string; tournaments: number };
  secondary: { id: string; name: string; email: string; tournaments: number };
  shared_tournaments: { tournament_id: string; tournament_name: string }[];
  can_merge: boolean;
}

const playersKey = (clubId: string) => ['admin', 'club-players', clubId];

function AddSheet({ clubId, onClose }: { clubId: string; onClose: () => void }) {
  useLocale();
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 250);
  const found = useQuery({
    queryKey: ['admin', 'club-candidates', clubId, debounced],
    queryFn: () =>
      api<Candidate[]>(
        `/clubs/${clubId}/players/candidates?q=${encodeURIComponent(debounced.trim())}`,
      ),
    enabled: debounced.trim().length >= 2,
  });
  const add = useAdminMutation({
    request: (c: Candidate) =>
      write(
        `/clubs/${clubId}/players`,
        c.profile_id ? { profile_id: c.profile_id } : { past_player_id: c.past_player_id },
      ),
    invalidate: [playersKey(clubId)],
    success: 'Player added to the club',
  });
  return (
    <ResponsiveSheet opened onClose={onClose} title={tx('Add a player to the club')} size="lg">
      <Stack>
        <TextInput
          label={tx('Search by name or email')}
          data-autofocus
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <MutationError error={add.error} />
        <Stack gap={4}>
          {(found.data ?? []).map((c) => (
            <Group key={c.profile_id ?? c.past_player_id} justify="space-between" wrap="nowrap">
              <Group gap={6}>
                <Text size="sm" fw={600}>
                  {c.name}
                </Text>
                {!c.has_hub_profile && (
                  <StatusBadge size="xs" variant="outline">
                    {tx('Past participant')}
                  </StatusBadge>
                )}
              </Group>
              <Button size="compact-md" variant="light" onClick={() => add.mutate(c)}>
                {tx('Add')}
              </Button>
            </Group>
          ))}
          {found.data && !found.data.length && (
            <Text size="sm" c="dimmed">
              {tx('No players found')}
            </Text>
          )}
        </Stack>
      </Stack>
    </ResponsiveSheet>
  );
}

function EditSheet({
  clubId,
  player,
  tiers,
  onClose,
}: {
  clubId: string;
  player: ClubPlayer;
  tiers: Tier[];
  onClose: () => void;
}) {
  useLocale();
  const [sport, setSport] = useState('padel');
  const elo = sport === 'padel' ? player.elo_padel : player.elo_tennis;
  const tier = sport === 'padel' ? player.tier_id_padel : player.tier_id_tennis;
  const hidden = sport === 'padel' ? player.hidden_padel : player.hidden_tennis;
  const [rating, setRating] = useState<number | string>(elo ?? 1000);
  const [pickedTier, setPickedTier] = useState<string>(tier ?? '');
  const [applyBase, setApplyBase] = useState(false);
  const [convertEmail, setConvertEmail] = useState(player.email ?? '');
  const invalidate = [playersKey(clubId)];
  const setElo = useAdminMutation({
    request: () =>
      write(
        `/clubs/${clubId}/players/${player.profile_id}/elo`,
        { elo: Number(rating), sport },
        'PATCH',
      ),
    invalidate,
    success: 'Rating updated',
  });
  const setTier = useAdminMutation({
    request: () =>
      write(
        `/clubs/${clubId}/players/${player.profile_id}/tier`,
        { sport, tier_id: pickedTier || null, apply_base_elo: applyBase },
        'PATCH',
      ),
    invalidate,
    success: 'Tier updated',
  });
  const visibility = useAdminMutation({
    request: () =>
      write(
        `/clubs/${clubId}/players/${player.profile_id}/sport-visibility`,
        { sport, hidden: !hidden },
        'PATCH',
      ),
    invalidate,
    success: 'Visibility updated',
  });
  const convert = useAdminMutation({
    request: () =>
      write<{ passphrase: string }>(`/clubs/${clubId}/players/${player.profile_id}/convert-ghost`, {
        name: player.name,
        email: convertEmail || null,
        lang: 'en',
      }),
    invalidate,
  });
  const forSport = tiers.filter((t) => t.sport === sport);
  return (
    <ResponsiveSheet opened onClose={onClose} title={player.name} size="md">
      <Stack>
        <SegmentedControl
          value={sport}
          onChange={(v) => {
            setSport(v);
            const e = v === 'padel' ? player.elo_padel : player.elo_tennis;
            setRating(e ?? 1000);
            setPickedTier((v === 'padel' ? player.tier_id_padel : player.tier_id_tennis) ?? '');
          }}
          aria-label={tx('Sport')}
          data={[
            { value: 'padel', label: tx('Padel') },
            { value: 'tennis', label: tx('Tennis') },
          ]}
        />
        <MutationError error={setElo.error ?? setTier.error ?? visibility.error ?? convert.error} />
        <Group align="flex-end" wrap="nowrap">
          <NumberInput
            flex={1}
            label={tx('Club rating')}
            min={0}
            max={4000}
            value={rating}
            onChange={setRating}
          />
          <Button variant="light" loading={setElo.isPending} onClick={() => setElo.mutate()}>
            {tx('Set rating')}
          </Button>
        </Group>
        <Stack gap="xs">
          <NativeSelect
            label={tx('Skill tier')}
            value={pickedTier}
            onChange={(e) => setPickedTier(e.currentTarget.value)}
            data={[
              { value: '', label: tx('No tier') },
              ...forSport.map((t) => ({
                value: t.id,
                label: `${t.name} (${Math.round(t.base_elo)})`,
              })),
            ]}
          />
          <Group justify="space-between" wrap="nowrap">
            <Checkbox
              label={tx("Also set the rating to the tier's base ELO")}
              checked={applyBase}
              onChange={(e) => setApplyBase(e.currentTarget.checked)}
            />
            <Button
              variant="light"
              loading={setTier.isPending}
              onClick={() => setTier.mutate()}
              style={{ flexShrink: 0 }}
            >
              {tx('Set tier')}
            </Button>
          </Group>
        </Stack>
        <Group justify="space-between">
          <Text size="sm">
            {hidden ? tx('Hidden from the leaderboard') : tx('Shown on the leaderboard')}
          </Text>
          <Button
            variant="default"
            loading={visibility.isPending}
            onClick={() => visibility.mutate()}
          >
            {hidden ? tx('Show') : tx('Hide')}
          </Button>
        </Group>
        {!player.has_hub_profile && (
          <Paper variant="row" p="sm">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {tx('Create a Player Hub profile')}
              </Text>
              <Text size="xs" c="dimmed">
                {tx('This past participant has no account. Creating one gives them a passphrase.')}
              </Text>
              {convert.data ? (
                <Notice tone="success">
                  {tx('Profile created. Passphrase:')} <Code>{convert.data.passphrase}</Code>
                </Notice>
              ) : (
                <Group align="flex-end" wrap="nowrap">
                  <TextInput
                    flex={1}
                    label={tx('Email')}
                    type="email"
                    value={convertEmail}
                    onChange={(e) => setConvertEmail(e.currentTarget.value)}
                  />
                  <Button loading={convert.isPending} onClick={() => convert.mutate()}>
                    {tx('Create profile')}
                  </Button>
                </Group>
              )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}

function BulkSheet({
  clubId,
  mode,
  ids,
  onClose,
}: {
  clubId: string;
  mode: 'announce' | 'invite';
  ids: string[];
  onClose: () => void;
}) {
  useLocale();
  const lobbies = useLobbyList();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [lobby, setLobby] = useState<string | null>(null);
  const send = useAdminMutation({
    request: () =>
      mode === 'announce'
        ? write<BulkResult>(`/clubs/${clubId}/players/announce`, {
            profile_ids: ids,
            subject,
            message,
          })
        : write<BulkResult>(`/clubs/${clubId}/players/invite-lobby`, {
            profile_ids: ids,
            registration_id: lobby,
          }),
  });
  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={mode === 'announce' ? tx('Announce to players') : tx('Invite to a lobby')}
    >
      {send.data ? (
        <Stack>
          <Notice tone={send.data.failed.length ? 'warning' : 'success'}>
            {tx('Sent {sent} of {requested}', {
              sent: send.data.sent,
              requested: send.data.requested,
            })}
          </Notice>
          {send.data.failed.map((f) => (
            <Text key={f.profile_id} size="sm" c="dimmed">
              {f.reason}
            </Text>
          ))}
          <FormActions>
            <Button onClick={onClose}>{tx('Done')}</Button>
          </FormActions>
        </Stack>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          <Stack>
            <MutationError error={send.error} />
            <Text size="sm" c="dimmed">
              {tx('{n} players selected. Only those with an email address receive it.', {
                n: ids.length,
              })}
            </Text>
            {mode === 'announce' ? (
              <>
                <TextInput
                  label={tx('Subject')}
                  required
                  maxLength={200}
                  value={subject}
                  onChange={(e) => setSubject(e.currentTarget.value)}
                />
                <Textarea
                  label={tx('Message')}
                  required
                  autosize
                  minRows={4}
                  maxLength={4000}
                  value={message}
                  onChange={(e) => setMessage(e.currentTarget.value)}
                />
              </>
            ) : (
              <Select
                label={tx('Registration lobby')}
                required
                data={(lobbies.data ?? [])
                  .filter((l) => l.open && !l.archived)
                  .map((l) => ({ value: l.id, label: l.name }))}
                value={lobby}
                onChange={setLobby}
              />
            )}
            <FormActions onCancel={onClose}>
              <Button
                type="submit"
                loading={send.isPending}
                leftSection={<IconMail size={16} />}
                disabled={mode === 'invite' ? !lobby : !subject.trim() || !message.trim()}
              >
                {tx('Send')}
              </Button>
            </FormActions>
          </Stack>
        </form>
      )}
    </ResponsiveSheet>
  );
}

// Duplicate past-participant profiles with the same name can be merged into one; two registered
// members can be merged after a preview that lists tournaments they share.
function CleanupSheet({
  clubId,
  players,
  sport,
  onClose,
}: {
  clubId: string;
  players: ClubPlayer[];
  sport: string;
  onClose: () => void;
}) {
  useLocale();
  const dupes = useQuery({
    queryKey: ['admin', 'club-duplicates', clubId],
    queryFn: () => api<DuplicateGroup[]>(`/clubs/${clubId}/players/ghost-duplicates`),
  });
  const merge = useAdminMutation({
    request: (g: DuplicateGroup) =>
      write(`/clubs/${clubId}/players/consolidate-ghosts`, {
        source_ids: g.profiles.map((p) => p.profile_id),
        name: g.name,
      }),
    invalidate: [playersKey(clubId), ['admin', 'club-duplicates', clubId]],
    success: 'Profiles merged',
  });
  const registered = players.filter((p) => p.has_hub_profile);
  const [primary, setPrimary] = useState<string | null>(null);
  const [secondary, setSecondary] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['admin', 'club-merge-preview', clubId, primary, secondary],
    queryFn: () =>
      api<MergePreview>(
        `/clubs/${clubId}/players/merge-hub/preview?primary_id=${primary}&secondary_id=${secondary}`,
      ),
    enabled: !!primary && !!secondary && primary !== secondary,
    retry: false,
  });
  const hub = useAdminMutation({
    request: () =>
      write(`/clubs/${clubId}/players/merge-hub`, { primary_id: primary, secondary_id: secondary }),
    invalidate: [playersKey(clubId)],
    success: 'Players merged',
    onSuccess: () => {
      setPrimary(null);
      setSecondary(null);
    },
  });
  const options = registered.map((p) => ({ value: p.profile_id, label: p.name }));
  return (
    <ResponsiveSheet opened onClose={onClose} title={tx('Duplicates and merging')} size="lg">
      <Stack gap="lg">
        <PossibleMembers
          clubId={clubId}
          players={players}
          sport={sport}
          invalidate={[playersKey(clubId), ['admin', 'club-duplicates', clubId]]}
        />
        <Stack gap="xs">
          <Text fw={600}>{tx('Same name, several past-participant profiles')}</Text>
          {dupes.isPending ? (
            <Loading />
          ) : !dupes.data?.length ? (
            <Text size="sm" c="dimmed">
              {tx('No duplicates found.')}
            </Text>
          ) : (
            dupes.data.map((g) => (
              <Group key={g.name} justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {g.name} · {tx('{n} profiles', { n: g.profiles.length })}
                </Text>
                <Button
                  size="compact-md"
                  variant="light"
                  loading={merge.isPending && merge.variables?.name === g.name}
                  onClick={() => merge.mutate(g)}
                >
                  {tx('Merge into one')}
                </Button>
              </Group>
            ))
          )}
          <MutationError error={merge.error} />
        </Stack>
        <Stack gap="xs">
          <Text fw={600}>{tx('Merge two registered players')}</Text>
          <Text size="xs" c="dimmed">
            {tx('The second player is merged into the first everywhere, not only in this club.')}
          </Text>
          <Select
            label={tx('Keep')}
            searchable
            data={options}
            value={primary}
            onChange={setPrimary}
          />
          <Select
            label={tx('Merge into the first')}
            searchable
            data={options.filter((o) => o.value !== primary)}
            value={secondary}
            onChange={setSecondary}
          />
          {preview.data && (
            <Notice tone={preview.data.can_merge ? 'info' : 'danger'}>
              {preview.data.can_merge
                ? tx('{a} ({na} events) and {b} ({nb} events) become one profile.', {
                    a: preview.data.primary.name,
                    na: preview.data.primary.tournaments,
                    b: preview.data.secondary.name,
                    nb: preview.data.secondary.tournaments,
                  })
                : tx('They played the same tournament: {names}', {
                    names: preview.data.shared_tournaments.map((s) => s.tournament_name).join(', '),
                  })}
            </Notice>
          )}
          <MutationError error={preview.error ?? hub.error} />
          <FormActions>
            <Button
              color="red"
              variant="light"
              disabled={!preview.data?.can_merge}
              loading={hub.isPending}
              onClick={() => hub.mutate()}
            >
              {tx('Merge players')}
            </Button>
          </FormActions>
        </Stack>
      </Stack>
    </ResponsiveSheet>
  );
}

export function ClubPlayers({ clubId }: { clubId: string }) {
  useLocale();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [sport, setSport] = useState('padel');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sheet, setSheet] = useState<'add' | 'cleanup' | 'announce' | 'invite' | null>(null);
  const [editing, setEditing] = useState<ClubPlayer | null>(null);
  const [removing, setRemoving] = useState<ClubPlayer | null>(null);
  const players = useQuery({
    queryKey: playersKey(clubId),
    queryFn: () => api<ClubPlayer[]>(`/clubs/${clubId}/players`),
  });
  const tiers = useQuery({
    queryKey: tiersKey(clubId),
    queryFn: () => api<Tier[]>(`/clubs/${clubId}/tiers`),
  });
  const remove = useAdminMutation({
    request: (p: ClubPlayer) =>
      write(`/clubs/${clubId}/players/${p.profile_id}`, undefined, 'DELETE'),
    invalidate: [playersKey(clubId)],
    success: 'Player removed from the club',
    onSuccess: () => setRemoving(null),
  });
  if (players.isPending) return <Loading />;
  if (players.error)
    return <ErrorState error={players.error} retry={() => void players.refetch()} />;
  const rows = players.data
    .filter((p) => (sport === 'padel' ? !p.hidden_padel : !p.hidden_tennis))
    .filter((p) => `${p.name} ${p.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort(
      (a, b) =>
        ((sport === 'padel' ? b.elo_padel : b.elo_tennis) ?? 0) -
        ((sport === 'padel' ? a.elo_padel : a.elo_tennis) ?? 0),
    );
  const rowMenu = (p: ClubPlayer) => (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon aria-label={tx('Options for {name}', { name: p.name })}>
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => setEditing(p)}>{tx('Rating and tier')}</Menu.Item>
        <Menu.Item
          color="red"
          onClick={() => {
            remove.reset();
            setRemoving(p);
          }}
        >
          {tx('Remove from club')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  const toggle = (id: string, on: boolean) =>
    setSelected((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  // Shown only while players are selected: the count on the left, what to do with them on the right.
  const selectionBar = (
    <Group justify="space-between" wrap="nowrap" gap="xs">
      <Text size="sm" fw={600}>
        {tx('{n} selected', { n: selected.length })}
      </Text>
      <Group gap="xs" wrap="nowrap">
        <Button variant="subtle" size="compact-md" onClick={() => setSelected([])}>
          {tx('Clear')}
        </Button>
        <Button variant="light" size="compact-md" onClick={() => setSheet('invite')}>
          {tx('Invite to a lobby')}
        </Button>
        <Button size="compact-md" onClick={() => setSheet('announce')}>
          {tx('Announce')}
        </Button>
      </Group>
    </Group>
  );
  return (
    <Stack gap="md">
      <Group justify="space-between">
        <SegmentedControl
          value={sport}
          onChange={setSport}
          aria-label={tx('Sport')}
          data={[
            { value: 'padel', label: tx('Padel') },
            { value: 'tennis', label: tx('Tennis') },
          ]}
        />
        <Group gap="xs">
          <Button variant="default" onClick={() => setSheet('cleanup')}>
            {tx('Duplicates and merging')}
          </Button>
          <Button leftSection={<IconUserPlus size={16} />} onClick={() => setSheet('add')}>
            {tx('Add player')}
          </Button>
        </Group>
      </Group>
      <Group justify="space-between">
        <TextInput
          maw={320}
          flex={1}
          aria-label={tx('Search players')}
          placeholder={tx('Search players')}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Button
          variant="subtle"
          size="compact-md"
          disabled={!rows.some((r) => r.email)}
          onClick={() => setSelected(rows.filter((r) => r.email).map((r) => r.profile_id))}
        >
          {tx('Select players with email')}
        </Button>
      </Group>
      {selected.length > 0 &&
        (phone ? (
          <>
            <ActionBarSpacer />
            <ActionBar data-testid="club-selection-bar">{selectionBar}</ActionBar>
          </>
        ) : (
          <Paper p="xs" px="sm" data-testid="club-selection-bar">
            {selectionBar}
          </Paper>
        ))}
      {!rows.length ? (
        <EmptyState title={tx('No players here yet')}>
          {tx('Players appear after they take part in a club tournament, or add them by hand.')}
        </EmptyState>
      ) : phone ? (
        // Phones: a row per player with the checkbox and the menu on it, no sideways scrolling.
        <Paper variant="list" role="list">
          <Checkbox
            p="sm"
            label={tx('Select all')}
            checked={rows.length > 0 && rows.every((r) => selected.includes(r.profile_id))}
            onChange={(e) =>
              setSelected(e.currentTarget.checked ? rows.map((r) => r.profile_id) : [])
            }
          />
          {rows.map((p) => (
            <Group
              key={p.profile_id}
              role="listitem"
              data-testid="club-player-row"
              wrap="nowrap"
              gap="xs"
              p="sm"
            >
              <Checkbox
                aria-label={tx('Select {name}', { name: p.name })}
                checked={selected.includes(p.profile_id)}
                onChange={(e) => toggle(p.profile_id, e.currentTarget.checked)}
              />
              <Stack gap={2} miw={0} flex={1}>
                <Group gap={6}>
                  <Text size="sm" fw={600}>
                    {p.name}
                  </Text>
                  {!p.has_hub_profile && (
                    <StatusBadge size="xs" variant="outline">
                      {tx('Past participant')}
                    </StatusBadge>
                  )}
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {p.email || '—'}
                </Text>
                <Text size="xs" c="dimmed">
                  {tx('ELO')}{' '}
                  {Math.round((sport === 'padel' ? p.elo_padel : p.elo_tennis) ?? 0) || '—'} ·{' '}
                  {sport === 'padel' ? p.matches_padel : p.matches_tennis} {tx('Matches')} ·{' '}
                  {(sport === 'padel' ? p.tier_name_padel : p.tier_name_tennis) || '—'}
                </Text>
              </Stack>
              {rowMenu(p)}
            </Group>
          ))}
        </Paper>
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={620}>
            <Table verticalSpacing="sm" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={1}>
                    <Checkbox
                      aria-label={tx('Select all')}
                      checked={
                        rows.length > 0 && rows.every((r) => selected.includes(r.profile_id))
                      }
                      onChange={(e) =>
                        setSelected(e.currentTarget.checked ? rows.map((r) => r.profile_id) : [])
                      }
                    />
                  </Table.Th>
                  <Table.Th>{tx('Player')}</Table.Th>
                  <Table.Th>{tx('ELO')}</Table.Th>
                  <Table.Th>{tx('Matches')}</Table.Th>
                  <Table.Th>{tx('Tier')}</Table.Th>
                  <Table.Th w={1} aria-label={tx('Actions')} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((p) => (
                  <Table.Tr key={p.profile_id} data-testid="club-player-row">
                    <Table.Td>
                      <Checkbox
                        aria-label={tx('Select {name}', { name: p.name })}
                        checked={selected.includes(p.profile_id)}
                        onChange={(e) => toggle(p.profile_id, e.currentTarget.checked)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Text size="sm" fw={600}>
                          {p.name}
                        </Text>
                        {!p.has_hub_profile && (
                          <StatusBadge size="xs" variant="outline">
                            {tx('Past participant')}
                          </StatusBadge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {p.email || '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {Math.round((sport === 'padel' ? p.elo_padel : p.elo_tennis) ?? 0) || '—'}
                    </Table.Td>
                    <Table.Td>{sport === 'padel' ? p.matches_padel : p.matches_tennis}</Table.Td>
                    <Table.Td>
                      {(sport === 'padel' ? p.tier_name_padel : p.tier_name_tennis) || '—'}
                    </Table.Td>
                    <Table.Td>{rowMenu(p)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      {sheet === 'add' && <AddSheet clubId={clubId} onClose={() => setSheet(null)} />}
      {sheet === 'cleanup' && (
        <CleanupSheet
          clubId={clubId}
          players={players.data}
          sport={sport}
          onClose={() => setSheet(null)}
        />
      )}
      {(sheet === 'announce' || sheet === 'invite') && (
        <BulkSheet clubId={clubId} mode={sheet} ids={selected} onClose={() => setSheet(null)} />
      )}
      {editing && (
        <EditSheet
          clubId={clubId}
          player={players.data.find((p) => p.profile_id === editing.profile_id) ?? editing}
          tiers={tiers.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmAction
        opened={!!removing}
        title={tx('Remove {name}?', { name: removing?.name })}
        description={tx(
          'They disappear from the roster and leaderboard. Their matches and ratings stay.',
        )}
        confirmLabel={tx('Remove')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </Stack>
  );
}
