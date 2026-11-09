import { ActionIcon, Modal, Stack, Text, type ActionIconProps } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconInfoCircle } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { SECTIONS } from './catalog';
import { InfoContent } from './InfoContent';

// A section of the guide (the same text as /admin/info) in a dialog, opened from an info button next to the
// feature it explains: "About ELO ratings" on the ratings page, "About this format" on the new-event form.
export function InfoSectionButton({
  id,
  label,
  summary,
  size,
}: {
  /** Section id in the guide catalog, for example `info-elo`. */
  id: string;
  label: string;
  /** One line shown above the section. */
  summary?: string;
  size?: ActionIconProps['size'];
}) {
  useLocale();
  const [opened, { open, close }] = useDisclosure(false);
  const section = SECTIONS.find((s) => s.id === id);
  return (
    <>
      <ActionIcon variant="subtle" size={size} aria-label={label} onClick={open}>
        <IconInfoCircle size={18} />
      </ActionIcon>
      <Modal opened={opened} onClose={close} title={label} size="lg">
        <Stack gap="sm">
          {summary && <Text fw={600}>{summary}</Text>}
          {section && <InfoContent section={section} />}
        </Stack>
      </Modal>
    </>
  );
}

export function EloInfoButton() {
  useLocale();
  return (
    <InfoSectionButton
      id="info-elo"
      label={tx('About ELO ratings')}
      summary={tx(
        'Your rating goes up when you beat higher-rated opponents and down when you lose to lower-rated ones. Everyone starts at 1000.',
      )}
    />
  );
}
