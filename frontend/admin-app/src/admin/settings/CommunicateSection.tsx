import { useState } from 'react';
import { Button, Group, Stack, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconMail } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { ConfirmAction, MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { Notice } from '../../ui/Notice';

interface SendResult {
  sent?: number | boolean;
  skipped?: number;
  failed?: number;
}
interface EmailSettings {
  sender_name: string;
  reply_to: string;
}

const summary = (r: SendResult) =>
  tx('Sent {sent}, skipped {skipped}, failed {failed}', {
    sent: typeof r.sent === 'number' ? r.sent : r.sent ? 1 : 0,
    skipped: r.skipped ?? 0,
    failed: r.failed ?? 0,
  });

interface Bulk {
  key: string;
  label: string;
  description: string;
  path: string;
  body?: unknown;
}

// Everything about e-mailing players for a running tournament or a registration lobby: sender
// identity, bulk sends (each behind a confirmation), and the organizer message.
export function CommunicateSection({ kind, id }: { kind: 'tournament' | 'lobby'; id: string }) {
  useLocale();
  const base = kind === 'tournament' ? `/tournaments/${id}` : `/registrations/${id}`;
  const status = useQuery({
    queryKey: ['admin', 'email-status'],
    queryFn: () => api<{ configured: boolean }>('/tournaments/email-status'),
    staleTime: 5 * 60_000,
  });
  const settingsKey = ['admin', 'email-settings', base];
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api<EmailSettings>(`${base}/email-settings`),
  });
  const [sender, setSender] = useState<string | null>(null);
  const [reply, setReply] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Bulk | null>(null);
  const saveSettings = useAdminMutation({
    request: () =>
      write(
        `${base}/email-settings`,
        {
          sender_name: sender ?? settings.data?.sender_name ?? '',
          reply_to: reply ?? settings.data?.reply_to ?? '',
        },
        'PATCH',
      ),
    invalidate: [settingsKey],
    success: 'Email settings saved',
  });
  const send = useAdminMutation({
    request: (bulk: Bulk) => write<SendResult>(`${base}/${bulk.path}`, bulk.body),
    success: (result) => summary(result),
    onSuccess: () => {
      setPending(null);
      setMessage('');
    },
  });
  const configured = status.data?.configured !== false;
  const bulks: Bulk[] =
    kind === 'tournament'
      ? [
          {
            key: 'started',
            label: 'Tournament started',
            description: 'Tell everyone the event has begun, with their login link.',
            path: 'notify-players',
          },
          {
            key: 'codes',
            label: 'Login codes',
            description: 'Send each player their passphrase and link.',
            path: 'send-all-emails',
          },
          {
            key: 'round',
            label: 'Next round',
            description: 'Tell the players in the current round where to go.',
            path: 'send-next-round-emails',
          },
          {
            key: 'results',
            label: 'Final results',
            description: 'Send the final standings to everyone.',
            path: 'send-results-emails',
          },
        ]
      : [
          {
            key: 'codes',
            label: 'Login codes',
            description: 'Send each registrant their passphrase and link.',
            path: 'send-all-emails',
          },
        ];
  return (
    <Stack gap="md">
      {!configured && (
        <Notice tone="warning" icon={<IconMail size={18} />}>
          {tx('Email is not set up on this server, so sending is disabled.')}
        </Notice>
      )}
      <Section
        title={tx('Sender')}
        description={tx('Name and reply address shown on emails to players.')}
      >
        <TextInput
          label={tx('Sender name')}
          maxLength={100}
          value={sender ?? settings.data?.sender_name ?? ''}
          onChange={(e) => setSender(e.currentTarget.value)}
        />
        <TextInput
          label={tx('Reply-to address')}
          type="email"
          value={reply ?? settings.data?.reply_to ?? ''}
          onChange={(e) => setReply(e.currentTarget.value)}
        />
        <MutationError error={saveSettings.error} />
        <Group justify="flex-end">
          <Button
            variant="default"
            loading={saveSettings.isPending}
            disabled={sender === null && reply === null}
            onClick={() => saveSettings.mutate()}
          >
            {tx('Save sender')}
          </Button>
        </Group>
      </Section>
      <Section
        title={tx('Send to everyone')}
        description={tx('Only players with an email address receive these.')}
      >
        <Stack gap="xs">
          {bulks.map((b) => (
            <Group key={b.key} justify="space-between" wrap="nowrap" align="center">
              <div>
                <Text fw={600} size="sm">
                  {tx(b.label)}
                </Text>
                <Text size="xs" c="dimmed">
                  {tx(b.description)}
                </Text>
              </div>
              <Button
                variant="light"
                disabled={!configured}
                onClick={() => {
                  send.reset();
                  setPending(b);
                }}
              >
                {tx('Send')}
              </Button>
            </Group>
          ))}
        </Stack>
      </Section>
      {kind === 'tournament' && (
        <Section
          title={tx('Message to players')}
          description={tx('A short note from you, sent to every player with an email address.')}
        >
          <Textarea
            aria-label={tx('Message to players')}
            autosize
            minRows={3}
            maxLength={2000}
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
          />
          <Group justify="flex-end">
            <Button
              disabled={!configured || !message.trim()}
              onClick={() => {
                send.reset();
                setPending({
                  key: 'message',
                  label: 'Message to players',
                  description: '',
                  path: 'send-message-emails',
                  body: { message: message.trim() },
                });
              }}
            >
              {tx('Send message')}
            </Button>
          </Group>
        </Section>
      )}
      {kind === 'lobby' && (
        <Section
          title={tx('Organizer message')}
          description={tx('Sends the message saved in lobby settings to registrants.')}
        >
          <Group justify="flex-end">
            {[false, true].map((eligible) => (
              <Button
                key={String(eligible)}
                variant="light"
                disabled={!configured}
                onClick={() => {
                  send.reset();
                  setPending({
                    key: eligible ? 'message-eligible' : 'message-all',
                    label: eligible ? 'Message to eligible players' : 'Message to everyone',
                    description: '',
                    path: 'send-message-emails',
                    body: { eligible_only: eligible },
                  });
                }}
              >
                {eligible ? tx('Eligible players only') : tx('Everyone')}
              </Button>
            ))}
          </Group>
        </Section>
      )}
      <ConfirmAction
        opened={!!pending}
        title={pending ? tx(pending.label) : undefined}
        description={tx('Send this email now? It cannot be recalled.')}
        confirmLabel={tx('Send')}
        loading={send.isPending}
        error={send.error}
        onConfirm={() => pending && send.mutate(pending)}
        onClose={() => setPending(null)}
      />
    </Stack>
  );
}

// A single "send login email" action used from player rows.
export function useSendOne(base: string) {
  return useAdminMutation({
    request: (playerId: string) => write(`${base}/send-email/${playerId}`),
    success: 'Email sent',
  });
}

export function notifyError(error: Error) {
  notifications.show({ message: tx(error.message), color: 'red' });
}
