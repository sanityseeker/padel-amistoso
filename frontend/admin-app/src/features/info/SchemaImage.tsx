import { useEffect, useState } from 'react';
import { Alert, Button, Group, Image, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconDownload, IconZoomIn } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';

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
}: {
  url: string | null;
  format?: SchemaFormat;
  filename: string;
  alt: string;
}) {
  useLocale();
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
  if (image.error) return <Alert color="red">{tx(image.error)}</Alert>;
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
      {image.src ? (
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
      <Modal opened={zoom} onClose={() => setZoom(false)} title={alt} size="auto" centered>
        {image.src && <Image src={image.src} alt={alt} maw="90vw" mah="80vh" fit="contain" />}
      </Modal>
    </Stack>
  );
}
