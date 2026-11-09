import { useState } from 'react';
import { Button, Group, Stack, TextInput } from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { CopyField, MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { useDemoAccount } from '../../useDemoAccount';

// A short public address (`/tv/my-cup`, `/register/my-cup`). PUT sets it, DELETE removes it.
export function AliasEditor({
  base,
  publicPath,
  alias,
  id,
  invalidate,
}: {
  base: string;
  /** `tv` or `register`. */
  publicPath: 'tv' | 'register';
  alias: string | null | undefined;
  id: string;
  invalidate: string[][];
}) {
  useLocale();
  const demo = useDemoAccount();
  const [value, setValue] = useState(alias ?? '');
  const save = useAdminMutation({
    request: () => write(`${base}/alias`, { alias: value.trim() }, 'PUT'),
    invalidate,
    success: 'Address saved',
  });
  const remove = useAdminMutation({
    request: () => write(`${base}/alias`, undefined, 'DELETE'),
    invalidate,
    success: 'Address removed',
    onSuccess: () => setValue(''),
  });
  const slug = alias || id;
  return (
    <Stack gap="xs">
      <TextInput
        label={tx('Public address')}
        disabled={demo}
        description={
          demo
            ? tx('Not available in demo mode')
            : tx(
                'Letters, numbers, hyphens and underscores. Players can type it instead of the ID.',
              )
        }
        placeholder={tx('my-tournament')}
        maxLength={64}
        pattern="[a-zA-Z0-9_\-]+"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      <CopyField
        value={`${window.location.origin}/${publicPath}/${slug}`}
        label={tx('Public address')}
      />
      <MutationError error={save.error ?? remove.error} />
      <Group justify="flex-end">
        {alias && (
          <Button
            variant="default"
            disabled={demo}
            loading={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {tx('Remove address')}
          </Button>
        )}
        <Button
          disabled={demo || !value.trim() || value.trim() === alias}
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          {tx('Save address')}
        </Button>
      </Group>
    </Stack>
  );
}
