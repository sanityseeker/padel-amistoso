import { Button, Group } from '@mantine/core';
import { IconBrandGithub, IconCoffee } from '@tabler/icons-react';
import { t as tx, useLocale } from '../i18n';

// The Ko-fi and GitHub support links shown on every page.
export function SupportFooter() {
  useLocale();
  return (
    <Group
      component="footer"
      justify="center"
      gap="xs"
      wrap="nowrap"
      px="sm"
      pt={48}
      pb={40}
      mt="auto"
    >
      <Button
        component="a"
        href="https://ko-fi.com/torneosamistosos"
        target="_blank"
        rel="noopener"
        variant="default"
        radius="xl"
        size="compact-sm"
        fz="xs"
        leftSection={<IconCoffee size={14} aria-hidden />}
      >
        {tx('Buy me a coffee')}
      </Button>
      <Button
        component="a"
        href="https://github.com/sanityseeker/padel-amistoso"
        target="_blank"
        rel="noopener"
        variant="default"
        radius="xl"
        size="compact-sm"
        fz="xs"
        leftSection={<IconBrandGithub size={14} aria-hidden />}
      >
        {tx('Contribute on GitHub')}
      </Button>
    </Group>
  );
}
