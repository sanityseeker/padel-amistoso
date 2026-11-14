import { useState } from 'react';
import { Button, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../../i18n';
import { playerApi } from '../../../player/api';
import type { Resolution } from '../../../player/types';
import { FormActions, ResponsiveSheet } from '../../../ui';
import { Notice } from '../../../ui/Notice';

// Link an event: resolve the passphrase (no token), pick the entry, then POST /player-profile/link.
export function LinkEvent({ close }: { close: () => void }) {
  useLocale();
  const client = useQueryClient();
  const [passphrase, setPassphrase] = useState('');
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: async () => {
      const result = await playerApi<Resolution>(
        '/player-profile/resolve',
        { passphrase: passphrase.trim() },
        'POST',
        null,
      );
      if (!result.matches.length)
        throw new Error(
          'No event entries found. Enter the passphrase issued for that tournament or registration.',
        );
      setResolution(result);
      setSelected('0');
    },
  });
  const link = useMutation({
    mutationFn: () => {
      const match = resolution!.matches[Number(selected)]!;
      return playerApi(
        '/player-profile/link',
        {
          entity_type: match.entity_type,
          entity_id: match.entity_id,
          passphrase: passphrase.trim(),
        },
        'POST',
      );
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['player'] });
      notifications.show({ message: tx('Event linked to your profile'), color: 'green' });
      close();
    },
  });
  return (
    <ResponsiveSheet opened onClose={close} title={tx('Link an event')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (resolution) link.mutate();
          else resolve.mutate();
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {tx(
              'Use your event passphrase to connect an existing registration or tournament to your profile.',
            )}
          </Text>
          {(resolve.error || link.error) && (
            <Notice tone="danger">{tx((resolve.error || link.error)!.message)}</Notice>
          )}
          <TextInput
            label={tx('Event passphrase')}
            autoComplete="off"
            required
            disabled={!!resolution}
            value={passphrase}
            onChange={(e) => setPassphrase(e.currentTarget.value)}
          />
          {resolution && (
            <Select
              label={tx('Event entry')}
              required
              allowDeselect={false}
              value={selected}
              onChange={setSelected}
              data={resolution.matches.map((m, i) => ({
                value: String(i),
                label: `${m.entity_name} · ${m.player_name}`,
              }))}
            />
          )}
          <FormActions
            onCancel={close}
            start={
              resolution && (
                <Button
                  variant="subtle"
                  onClick={() => {
                    setResolution(null);
                    resolve.reset();
                    link.reset();
                  }}
                >
                  {tx('Use another passphrase')}
                </Button>
              )
            }
          >
            <Button type="submit" loading={resolve.isPending || link.isPending}>
              {resolution ? tx('Link event') : tx('Find event')}
            </Button>
          </FormActions>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}
