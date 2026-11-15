import { useRef, useState } from 'react';
import { ActionIcon, Box, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import {
  IconArrowUpRight,
  IconDownload,
  IconMaximize,
  IconMinus,
  IconPlus,
  IconZoomReset,
} from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type { TvSettings } from '../../types';
import { schemaQuery, useSchemaSvg, useSchemaTheme, withQuery } from '../../bracketSchema';
import { SchemaViewer, ZoomableImage, type ZoomableImageHandle } from '../../ui';
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

// The server draws the bracket (GET /{prefix}/playoffs-schema) as an SVG coloured by CSS variables,
// placed in the page so it follows the app theme. The URL carries the organizer's drawing settings and a
// key made from the play-off data, so the picture is fetched again only when the bracket changes. A
// changed bracket keeps showing the previous picture until the new one has loaded, so the page does not
// collapse and jump while the server renders.
interface Opened {
  url: string;
  svg: string;
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
  onOpen: (opened: Opened) => void;
}) {
  const { svg, error } = useSchemaSvg(url);
  if (error && !svg)
    return pendingNote ? (
      <Text c="dimmed" size="sm" data-testid="bracket-pending">
        {pendingNote}
      </Text>
    ) : null;
  return (
    <Stack gap={4}>
      <Text variant="eyebrow">{label}</Text>
      {svg ? (
        <SchemaViewer
          markup={svg}
          label={label}
          onOpen={() => onOpen({ url, svg })}
          actions={
            <ActionIcon
              variant="default"
              aria-label={`${label}: ${tx('Enlarge')}`}
              onClick={() => onOpen({ url, svg })}
            >
              <IconMaximize size={16} aria-hidden />
            </ActionIcon>
          }
        />
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
  const [open, setOpen] = useState<Opened | null>(null);
  const theme = useSchemaTheme();
  // Opening or saving the picture gives a file in the colours the app shows now.
  const file = open ? withQuery(open.url, { theme }) : undefined;
  const [zoom, setZoom] = useState(1);
  const zoomer = useRef<ZoomableImageHandle>(null);
  const query = schemaQuery(settings, { _k: hash(JSON.stringify(playoffs)) });
  const base = `/api/tournaments/${tid}/${prefixFor(kind)}/playoffs-schema?${query}`;
  const sided = espejo || doubleElimination;
  const close = () => setOpen(null);
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
              onClick={() => zoomer.current?.zoomOut()}
            >
              <IconMinus size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label={tx('Reset zoom')}
              onClick={() => zoomer.current?.reset()}
            >
              <IconZoomReset size={16} />
            </ActionIcon>
            <Text size="sm" aria-live="polite">
              {Math.round(zoom * 100)}%
            </Text>
            <ActionIcon
              variant="default"
              aria-label={tx('Zoom in')}
              onClick={() => zoomer.current?.zoomIn()}
            >
              <IconPlus size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              component="a"
              href={file}
              target="_blank"
              rel="noopener"
              aria-label={tx('Open original image')}
            >
              <IconArrowUpRight size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              component="a"
              href={file}
              download="bracket"
              aria-label={tx('Download image')}
            >
              <IconDownload size={16} />
            </ActionIcon>
          </Group>
        }
      >
        {open && (
          <ZoomableImage
            ref={zoomer}
            svg={open.svg}
            alt={tx('Bracket')}
            className={classes.lightbox}
            maxHeight="calc(100dvh - 9rem)"
            onScaleChange={setZoom}
            testId="tv-bracket-zoom"
          />
        )}
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {tx('Pinch or double-tap to zoom')}
        </Text>
      </Modal>
    </Box>
  );
}
