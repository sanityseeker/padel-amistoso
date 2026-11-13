import { useEffect, useState } from 'react';
import { Button, Group, Image, Loader, Modal, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDownload, IconZoomIn } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { Notice } from '../../ui/Notice';
import { ZoomableImage } from '../../ui/ZoomableImage';

export type SchemaFormat = 'png' | 'svg' | 'pdf';

// Bracket diagrams are drawn by the server (GET /api/schema/*), anonymous and cacheable. The response
// is fetched as a blob, so an error body can be shown as text, and the image is shown from an object URL.
export function useSchemaImage(url: string | null, format: SchemaFormat = 'png') {
  const [state, setState] = useState<{
    src: string | null;
    blob: Blob | null;
    error: string | null;
    loading: boolean;
  }>({ src: null, blob: null, error: null, loading: false });
  useEffect(() => {
    if (!url) {
      setState({ src: null, blob: null, error: null, loading: false });
      return;
    }
    const controller = new AbortController();
    let created: string | null = null;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { detail?: unknown } | null;
          throw new Error(
            typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`,
          );
        }
        return res.blob();
      })
      .then((blob) => {
        // PDF has no inline preview; the blob is only offered as a download.
        created = format === 'pdf' ? null : URL.createObjectURL(blob);
        setState({ src: created, blob, error: null, loading: false });
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError')
          setState({ src: null, blob: null, error: e.message, loading: false });
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url, format]);
  return state;
}

export function SchemaImage({
  url,
  format = 'png',
  filename,
  alt,
  inlineZoom = false,
}: {
  url: string | null;
  format?: SchemaFormat;
  filename: string;
  alt: string;
  /** Pinch and double-tap zoom on the picture itself, for small screens. */
  inlineZoom?: boolean;
}) {
  useLocale();
  const phone = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const image = useSchemaImage(url, format);
  const [zoom, setZoom] = useState(false);
  if (!url) return null;
  if (image.loading)
    return (
      <Group gap="xs" justify="center" py="md" aria-busy="true">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          {tx('Generating')}
        </Text>
      </Group>
    );
  if (image.error) return <Notice tone="danger">{tx(image.error)}</Notice>;
  if (!image.blob) return null;
  const download = () => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(image.blob!);
    link.download = `${filename}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  return (
    <Stack gap="xs" align="center">
      {image.src && inlineZoom ? (
        <>
          <ZoomableImage
            src={image.src}
            alt={alt}
            testId="schema-image"
            maxHeight="calc(100dvh - 12rem)"
          />
          <Text size="xs" c="dimmed" ta="center">
            {tx('Pinch or double-tap to zoom')}
          </Text>
        </>
      ) : image.src ? (
        <Image
          src={image.src}
          alt={alt}
          data-testid="schema-image"
          maw="100%"
          style={{ cursor: 'zoom-in' }}
          onClick={() => setZoom(true)}
        />
      ) : (
        <Text size="sm" c="dimmed">
          {tx('The PDF is ready to download.')}
        </Text>
      )}
      <Group gap="xs">
        {image.src && (
          <Button
            variant="default"
            size="xs"
            leftSection={<IconZoomIn size={14} />}
            onClick={() => setZoom(true)}
          >
            {tx('Enlarge')}
          </Button>
        )}
        <Button
          variant="default"
          size="xs"
          leftSection={<IconDownload size={14} />}
          onClick={download}
        >
          {tx('Download')}
        </Button>
      </Group>
      <Modal
        opened={zoom}
        onClose={() => setZoom(false)}
        title={alt}
        size="xl"
        fullScreen={!!phone}
      >
        {image.src && (
          <ZoomableImage
            src={image.src}
            alt={alt}
            maxHeight={phone ? 'calc(100dvh - 7rem)' : '75vh'}
          />
        )}
        <Text size="xs" c="dimmed" ta="center" mt="xs">
          {tx('Pinch or double-tap to zoom')}
        </Text>
      </Modal>
    </Stack>
  );
}
