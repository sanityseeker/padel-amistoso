import { useState } from 'react';
import { Box, Button, Checkbox, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { IconPin, IconPinnedOff, IconTrash } from '@tabler/icons-react';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { Announcement } from '../../types';
import { ConfirmAction, EmptyState, FormActions, MutationError, StatusBadge } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { Markdown } from '../../features/public/Markdown';
import { AnnouncementTime } from '../../features/public/OrganizerNotes';
import classes from './AnnouncementsPanel.module.css';

/** Server limit of one announcement (backend/api/schemas.py ANNOUNCEMENT_MAX_LENGTH). */
const MAX_LENGTH = 5000;

// The workspace's Announcements tab (editors only): post during play, optionally with a push to the
// players who turned notifications on, then pin or delete. Players read the posts on their Hub
// event page and on the TV screen; both reload on the tournament's live-update stream.
export function AnnouncementsPanel({
  tid,
  announcements,
}: {
  tid: string;
  announcements: Announcement[];
}) {
  useLocale();
  const [text, setText] = useState('');
  const [notify, setNotify] = useState(true);
  const [removing, setRemoving] = useState<Announcement | null>(null);
  const refresh = [['admin', 'tournament', tid]];
  const base = `/tournaments/${tid}/announcements`;
  const post = useAdminMutation<{ text: string; notify: boolean }, Announcement>({
    request: (body) => write<Announcement>(base, body),
    invalidate: refresh,
    success: (_, body) => (body.notify ? 'Announcement posted and sent' : 'Announcement posted'),
    onSuccess: () => setText(''),
  });
  const pin = useAdminMutation<Announcement, Announcement>({
    request: (a) =>
      write<Announcement>(`${base}/${encodeURIComponent(a.id)}`, { pinned: !a.pinned }, 'PATCH'),
    invalidate: refresh,
    success: (result) => (result.pinned ? 'Announcement pinned' : 'Announcement unpinned'),
  });
  const remove = useAdminMutation<Announcement, unknown>({
    request: (a) => write(`${base}/${encodeURIComponent(a.id)}`, undefined, 'DELETE'),
    invalidate: refresh,
    success: 'Announcement deleted',
    onSuccess: () => setRemoving(null),
  });
  const blank = !text.trim();
  return (
    <Stack gap="lg" maw={720} data-testid="announcements-panel">
      <Stack gap="sm">
        <Textarea
          label={tx('New announcement')}
          description={tx(
            'Players see it on their event page and on the TV screen. Markdown: **bold**, *italic*, lists and links.',
          )}
          autosize
          minRows={3}
          maxRows={12}
          maxLength={MAX_LENGTH}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          data-testid="announcement-text"
        />
        <Text size="xs" c="dimmed" ta="right">
          {text.length} / {MAX_LENGTH}
        </Text>
        <Checkbox
          label={tx('Notify players')}
          description={tx('Send a push notification to players who turned notifications on.')}
          checked={notify}
          onChange={(e) => setNotify(e.currentTarget.checked)}
          data-testid="announcement-notify"
        />
        <MutationError error={post.error} />
        <FormActions>
          <Button
            onClick={() => post.mutate({ text, notify })}
            disabled={blank}
            loading={post.isPending}
            data-testid="announcement-post"
          >
            {tx('Post')}
          </Button>
        </FormActions>
      </Stack>
      <Stack gap="sm">
        <Title order={3}>{tx('Posted')}</Title>
        <MutationError error={pin.error} />
        {announcements.length === 0 ? (
          <EmptyState title={tx('No announcements yet')}>
            {tx('Posts appear here, newest first.')}
          </EmptyState>
        ) : (
          announcements.map((a) => (
            <Paper key={a.id} variant="row" p="sm" data-testid="admin-announcement">
              <Group gap="xs" mb={4}>
                {a.pinned && (
                  <StatusBadge tone="info" size="sm">
                    {tx('Pinned post')}
                  </StatusBadge>
                )}
                <AnnouncementTime iso={a.created_at} />
              </Group>
              <Box className={classes.text}>
                <Markdown source={a.text} />
              </Box>
              <Group gap="xs" mt="xs" justify="flex-end">
                <Button
                  size="compact-sm"
                  variant="subtle"
                  leftSection={
                    a.pinned ? (
                      <IconPinnedOff size={14} aria-hidden />
                    ) : (
                      <IconPin size={14} aria-hidden />
                    )
                  }
                  loading={pin.isPending && pin.variables?.id === a.id}
                  onClick={() => pin.mutate(a)}
                >
                  {a.pinned ? tx('Unpin') : tx('Pin')}
                </Button>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="red"
                  leftSection={<IconTrash size={14} aria-hidden />}
                  onClick={() => {
                    remove.reset();
                    setRemoving(a);
                  }}
                >
                  {tx('Delete')}
                </Button>
              </Group>
            </Paper>
          ))
        )}
      </Stack>
      <ConfirmAction
        opened={!!removing}
        title={tx('Delete this announcement?')}
        description={tx(
          'Players and the TV screen stop showing it. A notification already sent stays on their phones.',
        )}
        confirmLabel={tx('Delete')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      />
    </Stack>
  );
}
