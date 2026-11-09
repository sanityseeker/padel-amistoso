import { useEffect, useState } from 'react';
import { Button, Center, Image, Loader, Stack, Text } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { t as tx, useLocale } from '../i18n';
import { CopyField } from './CopyField';
import { ResponsiveSheet } from './ResponsiveSheet';

// The QR code is drawn in the browser (uqr, loaded only when a sheet opens), so it needs no endpoint:
// the lobby's public link is all there is to encode. Shown on a white card in both colour schemes,
// because scanners need dark modules on a light ground.
export function QrSheet({
  opened,
  onClose,
  title,
  value,
  caption,
  filename,
}: {
  opened: boolean;
  onClose: () => void;
  title: string;
  value: string;
  caption?: string;
  filename: string;
}) {
  useLocale();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!opened) return;
    let live = true;
    import('uqr')
      .then(({ renderSVG }) => {
        if (live) setSvg(renderSVG(value, { ecc: 'M', border: 2 }));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [opened, value]);
  const src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={title} size="sm">
      <Stack align="center" gap="md">
        {caption && (
          <Text c="dimmed" ta="center" size="sm">
            {caption}
          </Text>
        )}
        <Center bg="white" p="sm" style={{ borderRadius: 'var(--mantine-radius-md)' }}>
          {src ? (
            <Image src={src} alt={tx('QR code')} w={240} h={240} data-testid="qr-image" />
          ) : failed ? (
            <Text c="red">{tx('Unable to draw the QR code.')}</Text>
          ) : (
            <Loader aria-label={tx('Loading')} />
          )}
        </Center>
        <CopyField value={value} label={title} />
        <Button
          variant="default"
          leftSection={<IconDownload size={16} />}
          component="a"
          href={src ?? undefined}
          download={filename}
          disabled={!src}
        >
          {tx('Download QR code')}
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}
