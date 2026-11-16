import { useEffect, useState, type ReactNode } from 'react';
import { Box, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconPinFilled } from '@tabler/icons-react';
import { localeTag, t as tx, useLocale } from '../../i18n';
import type { Announcement } from '../../types';
import { StatusBadge } from '../../ui/StatusBadge';
import { Markdown } from './Markdown';
import classes from './OrganizerNotes.module.css';

/** The organizer's free text from the tournament's TV settings (anonymous GET .../tv-settings). */
export interface OrganizerNotes {
  custom_info_title?: string | null;
  custom_info_text?: string | null;
  /** Pinned first, then newest first, as the server sends them. */
  announcements?: Announcement[] | null;
}

export type NotesSize = 'tv' | 'app';

/** Anchor id of the custom information block (the Hub card links to `#info`). */
export const INFO_ANCHOR = 'info';

export const infoTextOf = (notes?: OrganizerNotes | null) => notes?.custom_info_text?.trim() ?? '';
export const infoTitleOf = (notes?: OrganizerNotes | null) =>
  notes?.custom_info_title?.trim() || tx('Information');

export const announcementsOf = (notes?: OrganizerNotes | null) =>
  (notes?.announcements ?? []).filter((a) => a.text.trim());

/** `created_at` of the most recent announcement (pinned or not), or null. */
export function newestAnnouncementAt(notes?: OrganizerNotes | null): string | null {
  let best: string | null = null;
  for (const a of announcementsOf(notes))
    if (!best || Date.parse(a.created_at) > Date.parse(best)) best = a.created_at;
  return best;
}

/** Anchor id of the announcements block (the Hub card's badge links to `#announcements`). */
export const ANNOUNCEMENTS_ANCHOR = 'announcements';

/** The organizer posted an announcement or wrote a custom information section. */
export const hasOrganizerNotes = (notes?: OrganizerNotes | null) =>
  !!infoTextOf(notes) || announcementsOf(notes).length > 0;

/** "5 minutes ago", "yesterday" in the interface language; a date after a week. */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((then - now) / 1000);
  const locale = localeTag();
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(seconds) < 45) return format.format(0, 'second');
  if (Math.abs(seconds) < 45 * 60) return format.format(Math.round(seconds / 60), 'minute');
  if (Math.abs(seconds) < 22 * 3600) return format.format(Math.round(seconds / 3600), 'hour');
  if (Math.abs(seconds) < 7 * 86400) return format.format(Math.round(seconds / 86400), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(then));
}

/** Re-render once a minute so relative times stay true on a screen left open. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** Posting time of an announcement: relative, with the full date and time on hover. */
export function AnnouncementTime({ iso, size = 'app' }: { iso: string; size?: NotesSize }) {
  const now = useMinuteClock();
  const then = Date.parse(iso);
  const full = Number.isNaN(then)
    ? ''
    : new Intl.DateTimeFormat(localeTag(), { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(then),
      );
  return (
    <Text
      component="time"
      dateTime={iso}
      title={full}
      size={size === 'tv' ? undefined : 'xs'}
      c="dimmed"
      className={size === 'tv' ? classes.tvTime : undefined}
    >
      {relativeTime(iso, now)}
    </Text>
  );
}

/** The organizer's announcements, pinned first then newest first, each with its posting time.
 * The first `limit` show at once; the rest behind "Show all". `wrap` works as in `OrganizerInfo`. */
export function Announcements({
  notes,
  size = 'app',
  testId,
  wrap,
  limit = 3,
}: {
  notes?: OrganizerNotes | null;
  size?: NotesSize;
  testId?: string;
  wrap?: (title: string, body: ReactNode) => ReactNode;
  limit?: number;
}) {
  useLocale();
  const [all, setAll] = useState(false);
  const items = announcementsOf(notes);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, limit);
  const tv = size === 'tv';
  const body = (
    <Stack gap="xs" data-testid={testId}>
      {shown.map((a) => (
        <Paper
          key={a.id}
          variant="row"
          p={{ base: 'sm', sm: 'md' }}
          data-testid="announcement"
          data-pinned={a.pinned || undefined}
        >
          <Group gap="xs" mb={4} wrap="wrap">
            {a.pinned && (
              <StatusBadge
                tone="info"
                size={tv ? 'lg' : 'sm'}
                leftSection={<IconPinFilled size={tv ? 16 : 12} aria-hidden />}
              >
                {tx('Pinned post')}
              </StatusBadge>
            )}
            <AnnouncementTime iso={a.created_at} size={size} />
          </Group>
          <Box className={`${classes.info} ${tv ? classes.tvInfo : ''}`}>
            <Markdown source={a.text} />
          </Box>
        </Paper>
      ))}
      {items.length > limit && (
        <Group>
          <Button variant="subtle" size={tv ? 'tv' : 'compact-sm'} onClick={() => setAll(!all)}>
            {all ? tx('Show fewer') : tx('Show all ({n})', { n: items.length })}
          </Button>
        </Group>
      )}
    </Stack>
  );
  const title = tx('Announcements');
  if (wrap) return <>{wrap(title, body)}</>;
  return (
    <Paper id={ANNOUNCEMENTS_ANCHOR} p={{ base: 'sm', sm: 'md' }} component="section">
      <Title order={2} mb="sm">
        {title}
      </Title>
      {body}
    </Paper>
  );
}

/** The custom information section (Markdown). `wrap` lets a screen supply its own section frame
 * (the TV page uses its collapsible Section); by default it is a titled card. */
export function OrganizerInfo({
  notes,
  size = 'app',
  testId,
  wrap,
}: {
  notes?: OrganizerNotes | null;
  size?: NotesSize;
  testId?: string;
  wrap?: (title: string, body: ReactNode) => ReactNode;
}) {
  const text = infoTextOf(notes);
  if (!text) return null;
  const title = infoTitleOf(notes);
  const body = (
    <Box className={`${classes.info} ${size === 'tv' ? classes.tvInfo : ''}`} data-testid={testId}>
      <Markdown source={text} />
    </Box>
  );
  if (wrap) return <>{wrap(title, body)}</>;
  return (
    <Paper id={INFO_ANCHOR} p={{ base: 'sm', sm: 'md' }} component="section">
      <Title order={2} mb="sm">
        {title}
      </Title>
      {body}
    </Paper>
  );
}
