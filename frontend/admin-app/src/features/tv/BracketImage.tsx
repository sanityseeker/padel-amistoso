import { useEffect, useState } from 'react';
import { ActionIcon, Box, Group, Loader, Modal, Stack, Text, UnstyledButton } from '@mantine/core';
import {
  IconArrowUpRight,
  IconDownload,
  IconMinus,
  IconPlus,
  IconZoomReset,
} from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type { TvSettings } from '../../types';
import { prefixFor, type Playoffs, type TvMeta } from './model';
import classes from './Tv.module.css';

/** Small non-cryptographic FNV-1a hash, base 36: the cache key of a bracket picture. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// The server draws the bracket (GET /{prefix}/playoffs-schema). The URL carries the organizer's drawing
// settings and a key made from the play-off data, so the picture is fetched again only when the bracket
// changes. A changed bracket keeps showing the previous picture until the new one has loaded, so the page
// does not collapse and jump while the server renders.
function useStableImage(url: string) {
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    const image = new window.Image();
    image.onload = () => live && setShown(url);
    image.onerror = () => live && setFailed(true);
    image.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return { shown, failed };
}

function Picture({
  url,
  label,
  pendingNote,
  onOpen,
}: {
  url: string;
  label: string;
  pendingNote?: string;
  onOpen: (url: string) => void;
}) {
  const { shown, failed } = useStableImage(url);
  if (failed && !shown)
    return pendingNote ? (
      <Text c="dimmed" size="sm" data-testid="bracket-pending">
        {pendingNote}
      </Text>
    ) : null;
  return (
    <Stack gap={4}>
      <Text variant="eyebrow">{label}</Text>
      {shown ? (
        <UnstyledButton
          onClick={() => onOpen(shown)}
          title={tx('Click to expand')}
          aria-label={`${label}: ${tx('Click to expand')}`}
        >
          <img className={classes.bracketImage} src={shown} alt={label} />
        </UnstyledButton>
      ) : (
        <Loader size="sm" aria-label={tx('Loading')} />
      )}
    </Stack>
  );
}

export function BracketImage({
  tid,
  kind,
  settings,
  playoffs,
  doubleElimination,
  espejo,
  split,
}: {
  tid: string;
  kind: TvMeta['type'];
  settings: TvSettings;
  playoffs: Playoffs;
  doubleElimination: boolean;
  espejo: boolean;
  split: boolean;
}) {
  useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const query = new URLSearchParams({
    fmt: settings.schema_format || 'svg',
    box_scale: String(settings.schema_box_scale || 1),
    line_width: String(settings.schema_line_width || 1),
    arrow_scale: String(settings.schema_arrow_scale || 1),
    title_font_scale: String(settings.schema_title_font_scale || 1),
    output_scale: String(settings.schema_output_scale || 1),
    _k: hash(JSON.stringify(playoffs)),
  });
  const base = `/api/tournaments/${tid}/${prefixFor(kind)}/playoffs-schema?${query}`;
  const sided = espejo || doubleElimination;
  const close = () => {
    setOpen(null);
    setZoom(1);
  };
  return (
    <Box className={classes.bracket} data-testid="tv-bracket">
      {sided ? (
        <Group align="flex-start" gap="lg" grow preventGrowOverflow={false}>
          <Picture
            url={`${base}&side=winners`}
            label={tx(split ? 'Gold bracket' : 'Winners Bracket')}
            onOpen={setOpen}
          />
          <Picture
            url={`${base}&side=losers`}
            label={tx(split ? 'Silver bracket' : 'Losers Bracket')}
            pendingNote={espejo ? tx('Losers Bracket seeded after Round 1 completes') : undefined}
            onOpen={setOpen}
          />
        </Group>
      ) : (
        <Picture url={base} label={tx('Play off bracket')} onOpen={setOpen} />
      )}
      <Text size="xs" c="dimmed" mt="xs">
        {tx('Tap image to expand')}
      </Text>
      <Modal
        opened={!!open}
        onClose={close}
        fullScreen
        title={
          <Group gap="xs">
            <Text fw={700}>{tx('Bracket')}</Text>
            <ActionIcon
              variant="default"
              aria-label={tx('Zoom out')}
              onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.25).toFixed(2)))}
            >
              <IconMinus size={16} />
            </ActionIcon>
            <ActionIcon variant="default" aria-label={tx('Reset zoom')} onClick={() => setZoom(1)}>
              <IconZoomReset size={16} />
            </ActionIcon>
            <Text size="sm" aria-live="polite">
              {Math.round(zoom * 100)}%
            </Text>
            <ActionIcon
              variant="default"
              aria-label={tx('Zoom in')}
              onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
            >
              <IconPlus size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              component="a"
              href={open ?? undefined}
              target="_blank"
              rel="noopener"
              aria-label={tx('Open original image')}
            >
              <IconArrowUpRight size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              component="a"
              href={open ?? undefined}
              download="bracket"
              aria-label={tx('Download image')}
            >
              <IconDownload size={16} />
            </ActionIcon>
          </Group>
        }
      >
        <Box className={classes.lightbox}>
          {open && (
            <img
              className={classes.lightboxImage}
              src={open}
              alt={tx('Bracket')}
              style={{ width: `${zoom * 100}%` }}
            />
          )}
        </Box>
      </Modal>
    </Box>
  );
}
