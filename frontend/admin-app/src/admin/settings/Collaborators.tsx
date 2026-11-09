import { useState } from 'react';
import { ActionIcon, Autocomplete, Button, Group, Stack, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { Loading } from '../../components';
import { EmptyState, MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

interface CollaboratorList {
  collaborators: string[];
}

// Co-editors of a tournament, lobby or club: list, add by username (with search), remove.
export function Collaborators({
  base,
  canManage = true,
}: {
  base: string;
  /** Adding and removing is owner/admin-only on the API; co-editors only see the list. */
  canManage?: boolean;
}) {
  useLocale();
  const key = ['admin', 'collaborators', base];
  const [name, setName] = useState('');
  const [debounced] = useDebouncedValue(name, 200);
  const list = useQuery({
    queryKey: key,
    queryFn: () => api<CollaboratorList>(`${base}/collaborators`),
  });
  const suggestions = useQuery({
    queryKey: ['admin', 'user-search', debounced],
    queryFn: () => api<string[]>(`/auth/users/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });
  const add = useAdminMutation({
    request: () => write<CollaboratorList>(`${base}/collaborators`, { username: name.trim() }),
    invalidate: [key],
    success: 'Co-editor added',
    onSuccess: () => setName(''),
  });
  const remove = useAdminMutation({
    request: (username: string) =>
      write<CollaboratorList>(
        `${base}/collaborators/${encodeURIComponent(username)}`,
        undefined,
        'DELETE',
      ),
    invalidate: [key],
    success: 'Co-editor removed',
  });
  if (list.isPending) return <Loading />;
  const people = list.data?.collaborators ?? [];
  return (
    <Stack gap="sm">
      {canManage && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add.mutate();
          }}
        >
          <Group align="flex-end" wrap="nowrap">
            <Autocomplete
              flex={1}
              label={tx('Add a co-editor')}
              description={tx('Co-editors can score and manage this, but cannot delete it.')}
              placeholder={tx('Username')}
              data={suggestions.data ?? []}
              value={name}
              onChange={setName}
            />
            <Button type="submit" loading={add.isPending} disabled={!name.trim()}>
              {tx('Add')}
            </Button>
          </Group>
        </form>
      )}
      <MutationError error={add.error ?? remove.error} />
      {!people.length ? (
        <EmptyState title={tx('No co-editors yet')}>
          {canManage ? tx('Add organizers who should be able to help run this.') : null}
        </EmptyState>
      ) : (
        <Stack gap={4}>
          {people.map((u) => (
            <Group key={u} justify="space-between" wrap="nowrap">
              <Text fw={600}>{u}</Text>
              {canManage && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={tx('Remove {name}', { name: u })}
                  onClick={() => remove.mutate(u)}
                >
                  <IconX size={16} />
                </ActionIcon>
              )}
            </Group>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
