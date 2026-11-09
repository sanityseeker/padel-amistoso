import { Alert, Anchor, Avatar, Group, Text } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { useSubdomainClub } from './subdomainClub';

// "You are managing {club}" on a club subdomain, with a link to the platform-wide admin.
export function SubdomainBanner() {
  useLocale();
  const host = useSubdomainClub();
  if (!host) return null;
  return (
    <Alert
      color="court"
      variant="light"
      mb="md"
      withCloseButton
      closeButtonLabel={tx('Dismiss')}
      onClose={host.dismiss}
      data-testid="subdomain-banner"
    >
      <Group gap="sm" wrap="wrap">
        {host.club.logo_url && <Avatar src={host.club.logo_url} size={24} alt="" />}
        <Text size="sm" fw={600}>
          {tx('You are managing {club}', { club: host.club.name })}
        </Text>
        <Anchor href={host.apexUrl} size="sm">
          {tx('Open platform admin')}
        </Anchor>
      </Group>
    </Alert>
  );
}
