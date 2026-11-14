import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { Tier } from '../../types';
import {
  ConfirmAction,
  EmptyState,
  FormActions,
  MutationError,
  ResponsiveSheet,
  Section,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

export function tiersKey(clubId: string) {
  return ['admin', 'tiers', clubId];
}

// Skill tiers: named bands with a base rating. A player assigned a tier can start from its base ELO.
export function ClubTiers({ clubId }: { clubId: string }) {
  useLocale();
  const key = tiersKey(clubId);
  const tiers = useQuery({ queryKey: key, queryFn: () => api<Tier[]>(`/clubs/${clubId}/tiers`) });
  const [editing, setEditing] = useState<Tier | 'new' | null>(null);
  const [form, setForm] = useState({ name: '', sport: 'padel', base_elo: 1000, position: 0 });
  const [deleting, setDeleting] = useState<Tier | null>(null);
  const save = useAdminMutation({
    request: () =>
      editing && editing !== 'new'
        ? write(
            `/clubs/${clubId}/tiers/${editing.id}`,
            { name: form.name, base_elo: form.base_elo, position: form.position },
            'PATCH',
          )
        : write(`/clubs/${clubId}/tiers`, form),
    invalidate: [key, ['admin', 'club-players', clubId]],
    success: 'Tier saved',
    onSuccess: () => setEditing(null),
  });
  const remove = useAdminMutation({
    request: (t: Tier) => write(`/clubs/${clubId}/tiers/${t.id}`, undefined, 'DELETE'),
    invalidate: [key, ['admin', 'club-players', clubId]],
    success: 'Tier deleted',
    onSuccess: () => setDeleting(null),
  });
  const open = (t: Tier | 'new') => {
    save.reset();
    setForm(
      t === 'new'
        ? { name: '', sport: 'padel', base_elo: 1000, position: tiers.data?.length ?? 0 }
        : { name: t.name, sport: t.sport, base_elo: t.base_elo, position: t.position },
    );
    setEditing(t);
  };
  if (tiers.isPending) return <Loading />;
  if (tiers.error) return <ErrorState error={tiers.error} />;
  return (
    <Section
      title={tx('Skill tiers')}
      actions={
        <Button onClick={() => open('new')} style={{ flexShrink: 0 }}>
          {tx('Add tier')}
        </Button>
      }
    >
      {!tiers.data.length ? (
        <EmptyState title={tx('No skill tiers yet')}>
          {tx('Tiers group players by level, for example Beginner, Intermediate and Advanced.')}
        </EmptyState>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {[...tiers.data]
            .sort((a, b) => a.sport.localeCompare(b.sport) || a.position - b.position)
            .map((t) => (
              <Paper key={t.id} variant="row" p="sm" data-testid="tier-row">
                <Group justify="space-between" wrap="nowrap">
                  <div>
                    <Text fw={600}>{t.name}</Text>
                    <Text size="xs" c="dimmed">
                      {t.sport === 'tennis' ? tx('Tennis') : tx('Padel')}
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Badge variant="light">
                      {Math.round(t.base_elo)} {tx('ELO')}
                    </Badge>
                    <ActionIcon aria-label={`${tx('Edit')}: ${t.name}`} onClick={() => open(t)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    <ActionIcon
                      color="red"
                      aria-label={`${tx('Delete')}: ${t.name}`}
                      onClick={() => {
                        remove.reset();
                        setDeleting(t);
                      }}
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Paper>
            ))}
        </SimpleGrid>
      )}
      <ResponsiveSheet
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? tx('Add tier') : tx('Edit tier')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Stack>
            <MutationError error={save.error} />
            <TextInput
              label={tx('Name')}
              required
              maxLength={50}
              data-autofocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            />
            <SimpleGrid cols={{ base: 1, xs: 3 }}>
              <NativeSelect
                label={tx('Sport')}
                disabled={editing !== 'new'}
                value={form.sport}
                onChange={(e) => setForm({ ...form, sport: e.currentTarget.value })}
                data={[
                  { value: 'padel', label: tx('Padel') },
                  { value: 'tennis', label: tx('Tennis') },
                ]}
              />
              <NumberInput
                label={tx('Base ELO')}
                min={0}
                max={3000}
                value={form.base_elo}
                onChange={(v) => setForm({ ...form, base_elo: Number(v) || 0 })}
              />
              <NumberInput
                label={tx('Order')}
                min={0}
                allowDecimal={false}
                value={form.position}
                onChange={(v) => setForm({ ...form, position: Number(v) || 0 })}
              />
            </SimpleGrid>
            <FormActions onCancel={() => setEditing(null)}>
              <Button type="submit" loading={save.isPending}>
                {tx('Save')}
              </Button>
            </FormActions>
          </Stack>
        </form>
      </ResponsiveSheet>
      <ConfirmAction
        opened={!!deleting}
        title={tx('Delete tier')}
        description={tx('Delete «{name}»? Players keep their rating.', { name: deleting?.name })}
        confirmLabel={tx('Delete')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </Section>
  );
}
