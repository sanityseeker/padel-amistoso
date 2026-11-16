import { useRef, useState } from 'react';
import { ActionIcon, Anchor, Box, Group, Loader, Modal, Stack, Text } from '@mantine/core';
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
/** Rounds shown by a windowed picture (`rounds=window:N`), from the SVG root the server drew. */
function shownRounds(svg: string): { from: number; to: number; total: number } | null {
  const m = /data-rounds-from="(\d+)" data-rounds-to="(\d+)" data-rounds-total="(\d+)"/.exec(svg);
  return m ? { from: Number(m[1]), to: Number(m[2]), total: Number(m[3]) } : null;
}

/** The inline picture shows a sliding window of this many rounds, from the earliest unfinished one. */
const WINDOW_ROUNDS = 3;

function Picture({
  url,
  fullUrl,
  label,
  pendingNote,
  onOpen,
}: {
  url: string;
  /** The same bracket with every round: what the full-screen view and the download show. */
  fullUrl: string;
  label: string;
  pendingNote?: string;
  onOpen: (url: string) => void;
}) {
  const { svg, error } = useSchemaSvg(url);
  if (error && !svg)
    return pendingNote ? (
      <Text c="dimmed" size="sm" data-testid="bracket-pending">
        {pendingNote}
      </Text>
    ) : null;
  const rounds = svg ? shownRounds(svg) : null;
  return (
    <Stack gap={4}>
      <Text variant="eyebrow">{label}</Text>
      {rounds && (
        <Text size="xs" c="dimmed" data-testid="bracket-window-note">
          {tx('Rounds {from}-{to} of {total}', rounds)}
          {' · '}
          <Anchor component="button" type="button" size="xs" onClick={() => onOpen(fullUrl)}>
            {tx('Full bracket')}
          </Anchor>
        </Text>
      )}
      {svg ? (
        <SchemaViewer
          markup={svg}
          label={label}
          minText="var(--fs-tv-sm)"
          onOpen={() => onOpen(fullUrl)}
          actions={
            <ActionIcon
              variant="default"
              aria-label={`${label}: ${tx('Enlarge')}`}
              onClick={() => onOpen(fullUrl)}
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
  const [open, setOpen] = useState<string | null>(null);
  const full = useSchemaSvg(open);
  const theme = useSchemaTheme();
  // Opening or saving the picture gives a file in the colours the app shows now.
  const file = open ? withQuery(open, { theme }) : undefined;
  const [zoom, setZoom] = useState(1);
  const zoomer = useRef<ZoomableImageHandle>(null);
  const query = schemaQuery(settings, { _k: hash(JSON.stringify(playoffs)) });
  const base = `/api/tournaments/${tid}/${prefixFor(kind)}/playoffs-schema?${query}`;
  const windowed = `${base}&rounds=window:${WINDOW_ROUNDS}`;
  const sided = espejo || doubleElimination;
  const close = () => setOpen(null);
  return (
    <Box className={classes.bracket} data-testid="tv-bracket">
      {sided ? (
        <Stack gap="lg">
          <Picture
            url={`${windowed}&side=winners`}
            fullUrl={`${base}&side=winners`}
            label={tx(split ? 'Gold bracket' : 'Winners Bracket')}
            onOpen={setOpen}
          />
          <Picture
            url={`${windowed}&side=losers`}
            fullUrl={`${base}&side=losers`}
            label={tx(split ? 'Silver bracket' : 'Losers Bracket')}
            pendingNote={espejo ? tx('Losers Bracket seeded after Round 1 completes') : undefined}
            onOpen={setOpen}
          />
        </Stack>
      ) : (
        <Picture url={windowed} fullUrl={base} label={tx('Play off bracket')} onOpen={setOpen} />
      )}
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
        {open && !full.svg && <Loader size="sm" aria-label={tx('Loading')} />}
        {open && full.svg && (
          <ZoomableImage
            ref={zoomer}
            svg={full.svg}
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
