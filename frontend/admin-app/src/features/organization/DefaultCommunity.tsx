import { useState } from 'react';
import { Button, Group, Select } from '@mantine/core';
import { write } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import type { Community, User } from '../../types';
import { MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

// The community new tournaments and lobbies start in for this account (PATCH /auth/me/settings).
export function DefaultCommunity({ communities }: { communities: Community[] }) {
  useLocale();
  const { user, setProfile } = useAuth();
  const [value, setValue] = useState<string | null>(user?.default_community_id ?? 'open');
  const save = useAdminMutation({
    request: () =>
      write<User>('/auth/me/settings', { default_community_id: value ?? 'open' }, 'PATCH'),
    success: 'Default community saved',
    onSuccess: (profile) => user && setProfile({ ...user, ...profile }),
  });
  const demo = !!user?.is_demo;
  return (
    <Section
      title={tx('My default community')}
      description={tx('New tournaments and lobbies you create start in this community.')}
    >
      <Group align="flex-end" wrap="wrap">
        <Select
          flex={1}
          miw={220}
          label={tx('Community')}
          allowDeselect={false}
          disabled={demo}
          data={communities.map((c) => ({
            value: c.id,
            label: c.is_builtin || c.id === 'open' ? tx('Global (default)') : c.name,
          }))}
          value={value}
          onChange={setValue}
        />
        <Button
          loading={save.isPending}
          disabled={demo || value === user?.default_community_id}
          onClick={() => save.mutate()}
        >
          {tx('Save')}
        </Button>
      </Group>
      <MutationError error={save.error} />
    </Section>
  );
}
