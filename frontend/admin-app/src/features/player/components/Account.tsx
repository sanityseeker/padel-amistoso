import { t as tx, useLocale } from '../../../i18n';
import { useState } from 'react';
import {
  Button,
  Card,
  CopyButton,
  Group,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { StatusBadge } from '../../../ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconCreditCard, IconMail } from '@tabler/icons-react';
import { ErrorState, Loading } from '../../../components';
import { money } from '../../../api';
import { playerApi } from '../../../player/api';
import type { HubPayment, Profile } from '../../../player/types';
import { Notice } from '../../../ui/Notice';
export function PlayerAccount({
  profile,
  editing = false,
}: {
  profile: Profile;
  editing?: boolean;
}) {
  useLocale();
  const client = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [contact, setContact] = useState(profile.contact);
  const [visible, setVisible] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      playerApi(
        '/player-profile',
        {
          name,
          email,
          contact,
        },
        'PUT',
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['player', 'space'],
      });
      notifications.show({
        message: tx('Profile updated'),
        color: 'green',
      });
    },
  });
  const verify = useMutation({
    mutationFn: () => playerApi('/player-profile/resend-verification', {}, 'POST'),
    onSuccess: () =>
      notifications.show({
        message: tx('Verification email requested. Check your inbox.'),
        color: 'green',
      }),
  });
  return (
    <Stack>
      {editing ? (
        <Paper p="xl">
          <Title order={3} mb="md">
            {tx('Your profile')}
          </Title>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Stack>
              {save.error && <Notice tone="danger">{tx(save.error.message)}</Notice>}
              <TextInput
                label={tx('Display name')}
                required
                maxLength={128}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <TextInput
                label={tx('Email address')}
                type="email"
                required
                maxLength={256}
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <TextInput
                label={tx('Contact details')}
                description={tx('Shared with organizers of your linked events')}
                maxLength={256}
                value={contact}
                onChange={(e) => setContact(e.currentTarget.value)}
              />
              <Button type="submit" loading={save.isPending}>
                {tx('Save profile')}
              </Button>
            </Stack>
          </form>
        </Paper>
      ) : (
        <Stack>
          {!profile.email_verified && (
            <Paper p="md">
              <Title order={3} mb="md">
                {tx('Email verification')}
              </Title>
              <Text size="sm" c="dimmed">
                {profile.email_verified
                  ? tx('Your email is verified and can help connect your event entries.')
                  : tx('Verify your email to connect entries registered with this address.')}
              </Text>
              {!profile.email_verified && (
                <Button
                  variant="light"
                  mt="md"
                  leftSection={<IconMail size={16} />}
                  loading={verify.isPending}
                  onClick={() => verify.mutate()}
                >
                  {tx('Resend verification')}
                </Button>
              )}
              {verify.error && (
                <Notice mt="md" tone="danger">
                  {tx(verify.error.message)}
                </Notice>
              )}
            </Paper>
          )}
          <Paper p="md">
            <Title order={3}>{tx('Your player passphrase')}</Title>
            <Text size="sm" c="dimmed" mt="sm" mb="md">
              {tx('Keep this private. It gives access to your player profile.')}
            </Text>
            {profile.passphrase && (
              <>
                <PasswordInput
                  aria-label={tx('Your player passphrase')}
                  readOnly
                  value={profile.passphrase}
                  visible={visible}
                  onVisibilityChange={setVisible}
                />
                <CopyButton value={profile.passphrase}>
                  {({ copied, copy }) => (
                    <Button
                      variant="subtle"
                      mt="sm"
                      onClick={copy}
                      leftSection={copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                    >
                      {copied ? tx('Copied') : tx('Copy passphrase')}
                    </Button>
                  )}
                </CopyButton>
              </>
            )}
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
function ReportPayment({ payment }: { payment: HubPayment }) {
  useLocale();
  const client = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [method, setMethod] = useState<string | null>(null);
  const [reference, setReference] = useState('');
  const report = useMutation({
    mutationFn: () =>
      playerApi(
        `/player-profile/payments/${encodeURIComponent(payment.key)}/report`,
        {
          method,
          reference,
        },
        'POST',
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['player', 'payments'],
      });
      setReporting(false);
      notifications.show({
        message: tx('Payment reported. Your organizer will confirm it.'),
        color: 'green',
      });
    },
  });
  return (
    <Card withBorder p="sm">
      <Group justify="space-between">
        <IconCreditCard color="var(--app-primary)" />
        <StatusBadge tone={payment.status === 'reported' ? 'warning' : 'neutral'}>
          {payment.status === 'reported'
            ? tx('Awaiting confirmation')
            : tx(payment.status.replace('_', ' '))}
        </StatusBadge>
      </Group>
      <Title order={3} size="sm" mt="sm">
        {payment.entity_name}
      </Title>
      <Text fw={650}>{money(payment.amount_cents, payment.currency)}</Text>
      {payment.instructions && (
        <Text size="sm" c="dimmed" mb="sm">
          {payment.instructions}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {tx('Transfer reference')}
      </Text>
      <Text size="sm" fw={600} mb="md">
        {payment.concept}
      </Text>
      {payment.methods.map((m, i) => (
        <Paper p="sm" key={i} mb="xs">
          <Text size="xs" c="dimmed">
            {m.label || m.kind}
          </Text>
          <Text size="sm">{m.value}</Text>
        </Paper>
      ))}
      {reporting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            report.mutate();
          }}
        >
          <Stack mt="md">
            {report.error && <Notice tone="danger">{tx(report.error.message)}</Notice>}
            <Select
              label={tx('Payment method')}
              clearable
              value={method}
              onChange={setMethod}
              data={['Cash', 'Bank transfer', 'Bizum', 'Other'].map((value) => ({
                value,
                label: tx(value),
              }))}
            />
            <Textarea
              label={tx('Payment reference')}
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.currentTarget.value)}
            />
            <Group>
              <Button type="submit" loading={report.isPending}>
                {tx('Report payment')}
              </Button>
              <Button variant="subtle" onClick={() => setReporting(false)}>
                {tx('Cancel')}
              </Button>
            </Group>
          </Stack>
        </form>
      ) : (
        payment.status === 'unpaid' && (
          <Button mt="md" variant="light" onClick={() => setReporting(true)}>
            {tx('I’ve paid')}
          </Button>
        )
      )}
    </Card>
  );
}
export function PlayerPayments() {
  useLocale();
  const payments = useQuery({
    queryKey: ['player', 'payments'],
    queryFn: () => playerApi<HubPayment[]>('/player-profile/payments'),
    refetchInterval: 30_000,
  });
  if (payments.isPending) return <Loading />;
  if (payments.error)
    return <ErrorState error={payments.error} retry={() => void payments.refetch()} />;
  if (!payments.data.length) return null;
  return (
    <Paper p="md">
      <Title order={2} size="h3" mb="sm">
        {tx('Pending payments')}
      </Title>
      <Stack gap="sm">
        {payments.data.map((p) => (
          <ReportPayment key={p.key} payment={p} />
        ))}
      </Stack>
    </Paper>
  );
}
