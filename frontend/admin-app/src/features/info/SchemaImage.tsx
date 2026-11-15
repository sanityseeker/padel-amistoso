import { useState } from 'react';
import { ActionIcon, Button, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDownload, IconMaximize } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { downloadSchema, useSchemaSvg, useSchemaTheme } from '../../bracketSchema';
import { Notice } from '../../ui/Notice';
import { SchemaViewer } from '../../ui/SchemaViewer';
import { ZoomableImage } from '../../ui/ZoomableImage';

export type SchemaFormat = 'png' | 'svg' | 'pdf';

// Bracket diagrams are drawn by the server (GET /api/schema/*), anonymous and cacheable. On screen the
// picture is an SVG placed in the page (SchemaViewer: fit or zoom, scrolled sideways), so it takes the
// app's colours and follows a theme switch. "Enlarge" opens it full size with pinch zoom.
// "Download" fetches `url` as it is (its `fmt` is the chosen format) in the colours the app shows now.
export function SchemaImage({
  url,
  filename,
  alt,
}: {
  url: string | null;
  filename: string;
  alt: string;
}) {
  useLocale();
  const phone = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const image = useSchemaSvg(url);
  const theme = useSchemaTheme();
  const [zoom, setZoom] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!url) return null;
  if (image.loading && !image.svg)
    return (
      <Group gap="xs" justify="center" py="md" aria-busy="true">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          {tx('Generating')}
        </Text>
      </Group>
    );
  if (image.error) return <Notice tone="danger">{tx(image.error)}</Notice>;
  if (!image.svg) return null;
  const download = () => {
    setSaveError(null);
    downloadSchema(url, theme, filename).catch((e: Error) => setSaveError(e.message));
  };
  return (
    <Stack gap="xs" w="100%">
      <SchemaViewer
        markup={image.svg}
        label={alt}
        testId="schema-image"
        onOpen={() => setZoom(true)}
        actions={
          <>
            <ActionIcon
              variant="default"
              aria-label={`${alt}: ${tx('Enlarge')}`}
              onClick={() => setZoom(true)}
            >
              <IconMaximize size={16} aria-hidden />
            </ActionIcon>
            <Button
              variant="default"
              size="compact-sm"
              h={28}
              leftSection={<IconDownload size={14} />}
              onClick={download}
            >
              {tx('Download')}
            </Button>
          </>
        }
      />
      {saveError && <Notice tone="danger">{tx(saveError)}</Notice>}
      <Modal
        opened={zoom}
        onClose={() => setZoom(false)}
        title={alt}
        size="xl"
        fullScreen={!!phone}
      >
        <ZoomableImage
          svg={image.svg}
          alt={alt}
          maxHeight={phone ? 'calc(100dvh - 7rem)' : '75vh'}
        />
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {tx('Pinch or double-tap to zoom')}
        </Text>
      </Modal>
    </Stack>
  );
}
