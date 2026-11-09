import { useRef, useState } from 'react';
import { Avatar, Button, FileButton, Group, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconBuilding } from '@tabler/icons-react';
import { useNavigate } from 'react-router-dom';
import { Collaborators } from '../../admin/settings/Collaborators';
import { upload, write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { Club } from '../../types';
import { ConfirmAction, CopyField, MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

const KEY = [['admin', 'clubs']];

export function ClubSettings({ club, isAdmin }: { club: Club; isAdmin: boolean }) {
  useLocale();
  const navigate = useNavigate();
  const [name, setName] = useState(club.name);
  const [slug, setSlug] = useState(club.slug ?? '');
  const [description, setDescription] = useState(club.description ?? '');
  const [reply, setReply] = useState(club.email_settings?.reply_to ?? '');
  const [sender, setSender] = useState(club.email_settings?.sender_name ?? '');
  const [confirm, setConfirm] = useState(false);
  const reset = useRef<() => void>(null);
  const rename = useAdminMutation({
    request: () => write(`/clubs/${club.id}`, { name: name.trim() }, 'PATCH'),
    invalidate: KEY,
    success: 'Club renamed',
  });
  const saveSlug = useAdminMutation({
    request: () => write(`/clubs/${club.id}/slug`, { slug: slug.trim() || null }, 'PATCH'),
    invalidate: KEY,
    success: 'Address saved',
  });
  const landing = useAdminMutation({
    request: () => write(`/clubs/${club.id}/landing`, { description }, 'PATCH'),
    invalidate: KEY,
    success: 'Landing page saved',
  });
  const email = useAdminMutation({
    request: () =>
      write(`/clubs/${club.id}/email-settings`, { reply_to: reply, sender_name: sender }, 'PATCH'),
    invalidate: KEY,
    success: 'Email settings saved',
  });
  const logo = useAdminMutation({
    request: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return upload(`/clubs/${club.id}/logo`, form, 'PUT');
    },
    invalidate: KEY,
    success: 'Logo updated',
    onSuccess: () => reset.current?.(),
  });
  const removeLogo = useAdminMutation({
    request: () => write(`/clubs/${club.id}/logo`, undefined, 'DELETE'),
    invalidate: KEY,
    success: 'Logo removed',
  });
  const recalc = useAdminMutation({
    request: () => write(`/clubs/${club.id}/elo/recalculate`),
    invalidate: [['admin', 'club-players', club.id]],
    success: 'Club ratings recalculated',
  });
  const remove = useAdminMutation({
    request: () => write(`/clubs/${club.id}`, undefined, 'DELETE'),
    invalidate: [...KEY, ['admin', 'tournaments'], ['admin', 'lobbies']],
    success: 'Club deleted',
    onSuccess: () => navigate('/admin/clubs'),
  });
  const host = window.location.host.replace(/^[^.]+\./, (m) => (m.startsWith('www') ? '' : m));
  return (
    <Stack gap="md">
      <Section title={tx('Identity')}>
        <Group align="flex-end">
          <Avatar
            src={club.has_logo ? `/api/clubs/${club.id}/logo?v=${Date.now() % 100000}` : undefined}
            size={64}
            radius="md"
          >
            <IconBuilding size={28} />
          </Avatar>
          <FileButton
            resetRef={reset}
            accept="image/png,image/jpeg,image/webp"
            onChange={(f) => f && logo.mutate(f)}
          >
            {(props) => (
              <Button variant="light" loading={logo.isPending} {...props}>
                {club.has_logo ? tx('Replace logo') : tx('Upload logo')}
              </Button>
            )}
          </FileButton>
          {club.has_logo && (
            <Button
              variant="default"
              loading={removeLogo.isPending}
              onClick={() => removeLogo.mutate()}
            >
              {tx('Remove logo')}
            </Button>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {tx('PNG, JPEG or WebP, up to 5 MB.')}
        </Text>
        <TextInput
          label={tx('Club name')}
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button
            disabled={!name.trim() || name.trim() === club.name}
            loading={rename.isPending}
            onClick={() => rename.mutate()}
          >
            {tx('Rename')}
          </Button>
        </Group>
        <MutationError error={rename.error ?? logo.error ?? removeLogo.error} />
      </Section>
      <Section
        title={tx('Landing page')}
        description={tx('A public page for your club with its events, leaderboard and seasons.')}
      >
        <TextInput
          label={tx('Subdomain')}
          description={tx(
            '2 to 30 characters: lowercase letters, digits and hyphens. Empty removes it.',
          )}
          maxLength={30}
          value={slug}
          onChange={(e) => setSlug(e.currentTarget.value)}
        />
        {club.slug && <CopyField value={`https://${club.slug}.${host}`} label={tx('Subdomain')} />}
        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={slug.trim() === (club.slug ?? '')}
            loading={saveSlug.isPending}
            onClick={() => saveSlug.mutate()}
          >
            {tx('Save address')}
          </Button>
        </Group>
        <Textarea
          label={tx('Tagline')}
          maxLength={500}
          autosize
          minRows={2}
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <Group justify="flex-end">
          <Button
            variant="default"
            disabled={description === (club.description ?? '')}
            loading={landing.isPending}
            onClick={() => landing.mutate()}
          >
            {tx('Save tagline')}
          </Button>
        </Group>
        <MutationError error={saveSlug.error ?? landing.error} />
      </Section>
      <Section title={tx('Email')} description={tx('Defaults for emails sent from this club.')}>
        <TextInput
          label={tx('Sender name')}
          maxLength={100}
          value={sender}
          onChange={(e) => setSender(e.currentTarget.value)}
        />
        <TextInput
          label={tx('Reply-to address')}
          type="email"
          value={reply}
          onChange={(e) => setReply(e.currentTarget.value)}
        />
        <MutationError error={email.error} />
        <Group justify="flex-end">
          <Button variant="default" loading={email.isPending} onClick={() => email.mutate()}>
            {tx('Save sender')}
          </Button>
        </Group>
      </Section>
      <Section title={tx('Co-editors')} description={tx('Organizers who can manage this club.')}>
        <Collaborators base={`/clubs/${club.id}`} />
      </Section>
      <Section
        title={tx('Ratings')}
        description={tx("Replay every tournament of this club, then the club's own rating chain.")}
      >
        <MutationError error={recalc.error} />
        <Group>
          <Button variant="light" loading={recalc.isPending} onClick={() => recalc.mutate()}>
            {tx('Recalculate club ratings')}
          </Button>
        </Group>
      </Section>
      {isAdmin && (
        <Section
          title={tx('Delete club')}
          description={tx('Tournaments and ratings stay. Branding, tiers and seasons are removed.')}
        >
          <Group>
            <Button color="red" variant="light" onClick={() => setConfirm(true)}>
              {tx('Delete club')}
            </Button>
          </Group>
        </Section>
      )}
      <ConfirmAction
        opened={confirm}
        title={tx('Delete club')}
        description={tx('Delete «{name}»? This cannot be undone.', { name: club.name })}
        confirmLabel={tx('Delete')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirm(false)}
      />
    </Stack>
  );
}
