import { useState } from 'react';
import {
  Button,
  Checkbox,
  Code,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue, useMediaQuery } from '@mantine/hooks';
import { IconSearch } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { ErrorState, Loading, useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import {
  ConfirmAction,
  EmptyState,
  EventRow,
  MutationError,
  PageHeader,
  ResponsiveSheet,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { FoldInto } from './FoldInto';
import { LinkParticipation } from './LinkParticipation';
import { Notice } from '../../ui/Notice';
import { StatusBadge } from '../../ui/StatusBadge';

interface Profile {
  id: string;
  name: string;
  email: string;
  passphrase: string;
  created_at: string;
  elo_padel: number;
  elo_padel_matches: number;
  elo_tennis: number;
  elo_tennis_matches: number;
  k_factor_override: number | null;
  is_ghost: boolean;
}
interface Participation {
  tournament_id: string;
  player_id: string;
  player_name: string;
  tournament_name: string;
  status: 'active' | 'finished';
}
interface Detail extends Profile {
  contact: string;
  participations: Participation[];
}
interface Preview {
  primary: { name: string; tournaments: number };
  secondary: { name: string; tournaments: number };
  shared_tournaments: { tournament_id: string; tournament_name: string }[];
  can_merge: boolean;
}

const LIST = ['admin', 'profiles-admin'];

// `scope` is the list's club / community filter: the sheet then shows that scope's rating and matches.
function ProfileSheet({ id, scope, onClose }: { id: string; scope: string; onClose: () => void }) {
  useLocale();
  const detailKey = ['admin', 'profile', id, scope];
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () => api<Detail>(`/admin/player-profiles/${id}${scope ? `?${scope}` : ''}`),
  });
  const invalidate = [detailKey, LIST];
  const [name, setName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [k, setK] = useState<number | string | null>(null);
  const [confirm, setConfirm] = useState<'delete' | 'passphrase' | null>(null);
  const [mergeWith, setMergeWith] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const p = detail.data;
  const preview = useQuery({
    queryKey: ['admin', 'profile-merge-preview', id, mergeWith],
    queryFn: () =>
      api<Preview>(
        `/admin/player-profiles/merge-hub/preview?primary_id=${id}&secondary_id=${mergeWith}`,
      ),
    enabled: !!mergeWith && !p?.is_ghost,
    retry: false,
  });
  const rename = useAdminMutation({
    request: () =>
      write(`/admin/player-profiles/${id}/name`, { name: (name ?? p!.name).trim() }, 'PUT'),
    invalidate,
    success: 'Name updated',
    onSuccess: () => setName(null),
  });
  const mail = useAdminMutation({
    request: () =>
      write(`/admin/player-profiles/${id}/email`, { email: (email ?? p!.email).trim() }, 'PUT'),
    invalidate,
    success: 'Email updated',
    onSuccess: () => setEmail(null),
  });
  const kFactor = useAdminMutation({
    request: () =>
      write(
        `/admin/player-profiles/${id}/k-factor`,
        {
          k_factor_override:
            (k ?? p!.k_factor_override) === '' ? null : (k ?? p!.k_factor_override),
        },
        'PUT',
      ),
    invalidate,
    success: 'K-factor updated',
    onSuccess: () => setK(null),
  });
  const reset = useAdminMutation({
    request: () => write<{ passphrase: string }>(`/admin/player-profiles/${id}/reset-passphrase`),
    invalidate,
    onSuccess: (r) => {
      setPassphrase(r.passphrase);
      setConfirm(null);
    },
  });
  const remove = useAdminMutation({
    request: () => write(`/admin/player-profiles/${id}`, undefined, 'DELETE'),
    invalidate: [LIST],
    success: 'Profile deleted',
    onSuccess: onClose,
  });
  const [unlinking, setUnlinking] = useState<Participation | null>(null);
  const unlink = useAdminMutation({
    request: (x: Participation) =>
      write(`/admin/player-profiles/link/${x.tournament_id}/${x.player_id}`, undefined, 'DELETE'),
    invalidate,
    success: 'Participation unlinked',
    onSuccess: () => setUnlinking(null),
  });
  const convert = useAdminMutation({
    request: () =>
      write<{ passphrase: string }>(`/admin/player-profiles/${id}/convert-ghost`, {
        name: p!.name,
        email: email ?? (p!.email || null),
        lang: 'en',
      }),
    invalidate,
    onSuccess: (r) => setPassphrase(r.passphrase),
  });
  const hub = useAdminMutation({
    request: () =>
      write(`/admin/player-profiles/merge-hub`, { primary_id: id, secondary_id: mergeWith }),
    invalidate,
    success: 'Players merged',
    onSuccess: () => setMergeWith(null),
  });
  const others = useQuery({
    queryKey: ['admin', 'profiles', 'merge-picker'],
    queryFn: () => api<Profile[]>('/admin/player-profiles?limit=500'),
    enabled: !!p && !p.is_ghost,
  });
  return (
    <ResponsiveSheet opened onClose={onClose} title={p?.name ?? tx('Player profile')} size="lg">
      {!p ? (
        <Loading />
      ) : (
        <Stack gap="md">
          <Group gap="xs">
            {p.is_ghost && <StatusBadge variant="outline">{tx('Past participant')}</StatusBadge>}
            <Text size="sm" c="dimmed">
              {tx('Padel {a} · Tennis {b}', {
                a: Math.round(p.elo_padel),
                b: Math.round(p.elo_tennis),
              })}
            </Text>
          </Group>
          {passphrase && (
            <Notice tone="success">
              {tx('Passphrase:')} <Code>{passphrase}</Code>
            </Notice>
          )}
          <MutationError
            error={
              rename.error ??
              mail.error ??
              kFactor.error ??
              reset.error ??
              remove.error ??
              unlink.error ??
              convert.error
            }
          />
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              flex={1}
              label={tx('Name')}
              value={name ?? p.name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Button
              variant="light"
              disabled={name === null}
              loading={rename.isPending}
              onClick={() => rename.mutate()}
            >
              {tx('Save')}
            </Button>
          </Group>
          <Group align="flex-end" wrap="nowrap">
            <TextInput
              flex={1}
              label={tx('Email')}
              type="email"
              value={email ?? p.email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
            <Button
              variant="light"
              disabled={email === null}
              loading={mail.isPending}
              onClick={() => mail.mutate()}
            >
              {tx('Save')}
            </Button>
          </Group>
          <Group align="flex-end" wrap="nowrap">
            <NumberInput
              flex={1}
              label={tx('K-factor override')}
              description={tx('Empty uses the default.')}
              min={1}
              max={200}
              allowDecimal={false}
              value={k ?? p.k_factor_override ?? ''}
              onChange={setK}
            />
            <Button
              variant="light"
              disabled={k === null}
              loading={kFactor.isPending}
              onClick={() => kFactor.mutate()}
            >
              {tx('Save')}
            </Button>
          </Group>
          <Stack gap="xs">
            <Text fw={600}>{tx('Events')}</Text>
            {!p.participations.length && (
              <Text size="sm" c="dimmed">
                {tx('Not linked to any event.')}
              </Text>
            )}
            {p.participations.map((x) => (
              <Group key={x.tournament_id + x.player_id} justify="space-between" wrap="nowrap">
                <Text size="sm">
                  {x.tournament_name}{' '}
                  <Text span c="dimmed">
                    · {x.player_name}
                  </Text>
                </Text>
                <Button size="compact-md" variant="default" onClick={() => setUnlinking(x)}>
                  {tx('Unlink')}
                </Button>
              </Group>
            ))}
            <LinkParticipation profileId={id} invalidate={[detailKey, LIST]} />
          </Stack>
          {p.is_ghost ? (
            <Stack gap="xs">
              <Text fw={600}>{tx('Past participant tools')}</Text>
              <Button
                variant="light"
                w="fit-content"
                loading={convert.isPending}
                disabled={!!convert.data}
                onClick={() => convert.mutate()}
              >
                {tx('Convert to a Player Hub profile')}
              </Button>
              <FoldInto id={id} name={p.name} keepName invalidate={[detailKey, LIST]} />
            </Stack>
          ) : (
            <Stack gap="md">
              <FoldInto id={id} name={p.name} keepName={false} invalidate={[detailKey, LIST]} />
              <Stack gap="xs">
                <Text fw={600}>{tx('Merge a duplicate into this profile')}</Text>
                <Select
                  searchable
                  aria-label={tx('Profile to merge')}
                  placeholder={tx('Choose a registered player')}
                  clearable
                  data={(others.data ?? [])
                    .filter((o) => o.id !== id && !o.is_ghost)
                    .map((o) => ({
                      value: o.id,
                      label: `${o.name}${o.email ? ` (${o.email})` : ''}`,
                    }))}
                  value={mergeWith}
                  onChange={setMergeWith}
                />
                {preview.data && (
                  <Notice tone={preview.data.can_merge ? 'info' : 'danger'}>
                    {preview.data.can_merge
                      ? tx('{b} ({nb} events) joins {a} ({na} events).', {
                          a: preview.data.primary.name,
                          na: preview.data.primary.tournaments,
                          b: preview.data.secondary.name,
                          nb: preview.data.secondary.tournaments,
                        })
                      : tx('They played the same tournament: {names}', {
                          names: preview.data.shared_tournaments
                            .map((s) => s.tournament_name)
                            .join(', '),
                        })}
                  </Notice>
                )}
                <MutationError error={preview.error ?? hub.error} />
                <Group justify="flex-end">
                  <Button
                    variant="light"
                    color="red"
                    disabled={!preview.data?.can_merge}
                    loading={hub.isPending}
                    onClick={() => hub.mutate()}
                  >
                    {tx('Merge players')}
                  </Button>
                </Group>
              </Stack>
            </Stack>
          )}
          <Group justify="space-between">
            {!p.is_ghost && (
              <Button variant="default" onClick={() => setConfirm('passphrase')}>
                {tx('Reset passphrase')}
              </Button>
            )}
            <Button color="red" variant="light" onClick={() => setConfirm('delete')}>
              {tx('Delete profile')}
            </Button>
          </Group>
          <ConfirmAction
            opened={!!unlinking}
            title={tx('Unlink participation')}
            description={
              unlinking?.status === 'finished'
                ? tx(
                    "This removes the tournament stats from this player's hub and recalculates their ELO. The participation can be linked again later.",
                  )
                : tx('Unlink this active tournament participation?')
            }
            confirmLabel={tx('Unlink')}
            color="red"
            loading={unlink.isPending}
            error={unlink.error}
            onConfirm={() => unlinking && unlink.mutate(unlinking)}
            onClose={() => setUnlinking(null)}
          />
          <ConfirmAction
            opened={confirm === 'passphrase'}
            title={tx('Reset passphrase')}
            description={tx('The old passphrase stops working immediately.')}
            loading={reset.isPending}
            error={reset.error}
            onConfirm={() => reset.mutate()}
            onClose={() => setConfirm(null)}
          />
          <ConfirmAction
            opened={confirm === 'delete'}
            title={tx('Delete profile')}
            description={tx('Delete «{name}»? Ratings and history of this profile are removed.', {
              name: p.name,
            })}
            confirmLabel={tx('Delete')}
            color="red"
            loading={remove.isPending}
            error={remove.error}
            onConfirm={() => remove.mutate()}
            onClose={() => setConfirm(null)}
          />
        </Stack>
      )}
    </ResponsiveSheet>
  );
}

// Every Player Hub profile and every past participant, for site administrators: search, fix names and
// emails, reset a passphrase, convert a past participant into an account, merge duplicates.
export function AdminPlayersPage() {
  useLocale();
  const { clubs, communities } = useOverview();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 250);
  const [club, setClub] = useState<string | null>(null);
  const [community, setCommunity] = useState<string | null>(null);
  const [ghosts, setGhosts] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const params = new URLSearchParams({ q: debounced.trim(), limit: '300' });
  if (club) params.set('club_id', club);
  else if (community) params.set('community_id', community);
  const scopeParams = club
    ? `club_id=${encodeURIComponent(club)}`
    : community
      ? `community_id=${encodeURIComponent(community)}`
      : '';
  const list = useQuery({
    queryKey: [...LIST, params.toString()],
    queryFn: () => api<Profile[]>(`/admin/player-profiles?${params.toString()}`),
  });
  const rows = (list.data ?? []).filter((r) => ghosts || !r.is_ghost);
  return (
    <Stack gap="lg">
      <PageHeader
        title={tx('Player profiles')}
        description={tx('Every account and past participant on this site.')}
      />
      <Group gap="sm" align="flex-end">
        <TextInput
          flex={1}
          miw={220}
          maw={380}
          aria-label={tx('Search players')}
          placeholder={tx('Search by name or email')}
          leftSection={<IconSearch size={16} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Select
          aria-label={tx('Community')}
          placeholder={tx('Any community')}
          clearable
          data={(communities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={community}
          onChange={(v) => {
            setCommunity(v);
            setClub(null);
          }}
        />
        <Select
          aria-label={tx('Club')}
          placeholder={tx('Any club')}
          clearable
          data={(clubs.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={club}
          onChange={setClub}
        />
        <Checkbox
          label={tx('Include past participants')}
          checked={ghosts}
          onChange={(e) => setGhosts(e.currentTarget.checked)}
        />
      </Group>
      {list.isPending ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} retry={() => void list.refetch()} />
      ) : !rows.length ? (
        <EmptyState title={tx('No profiles found')}>{tx('Try another search.')}</EmptyState>
      ) : phone ? (
        <Stack gap="xs">
          {rows.map((r) => (
            <EventRow
              key={r.id}
              title={r.name}
              meta={r.email || tx('No email')}
              testId="profile-row"
              badges={
                <>
                  {r.is_ghost && (
                    <StatusBadge size="xs" variant="outline">
                      {tx('Past participant')}
                    </StatusBadge>
                  )}
                  <Text size="xs">
                    {Math.round(r.elo_padel)} / {Math.round(r.elo_tennis)}
                  </Text>
                </>
              }
              actions={
                <Button variant="light" size="compact-md" onClick={() => setOpen(r.id)}>
                  {tx('Manage')}
                </Button>
              }
            />
          ))}
        </Stack>
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing="sm" stickyHeader highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Name')}</Table.Th>
                  <Table.Th>{tx('Email')}</Table.Th>
                  <Table.Th>{tx('Padel')}</Table.Th>
                  <Table.Th>{tx('Tennis')}</Table.Th>
                  <Table.Th w={1} aria-label={tx('Actions')} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.id} data-testid="profile-row">
                    <Table.Td>
                      <Group gap={6}>
                        <Text size="sm" fw={600}>
                          {r.name}
                        </Text>
                        {r.is_ghost && (
                          <StatusBadge size="xs" variant="outline">
                            {tx('Past participant')}
                          </StatusBadge>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>{r.email || '—'}</Table.Td>
                    <Table.Td>
                      {Math.round(r.elo_padel)} · {r.elo_padel_matches}
                    </Table.Td>
                    <Table.Td>
                      {Math.round(r.elo_tennis)} · {r.elo_tennis_matches}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="compact-md"
                        variant="light"
                        aria-label={`${tx('Manage')}: ${r.name}`}
                        onClick={() => setOpen(r.id)}
                      >
                        {tx('Manage')}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      {open && <ProfileSheet id={open} scope={scopeParams} onClose={() => setOpen(null)} />}
    </Stack>
  );
}
