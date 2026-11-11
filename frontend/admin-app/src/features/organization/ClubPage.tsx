import { Avatar, Button, Stack, Tabs, Title } from '@mantine/core';
import { IconBuilding } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../auth';
import { ErrorState, Loading, useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import { PageHeader } from '../../ui';
import { ClubEvents } from './ClubEvents';
import { ClubPlayers } from './ClubPlayers';
import { ClubSeasons } from './ClubSeasons';
import { ClubSettings } from './ClubSettings';
import { ClubTiers } from './ClubTiers';

// One club: its seasons, skill tiers, player roster and settings.
export function ClubPage() {
  useLocale();
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { clubs, communities } = useOverview();
  const [tab, setTab] = useState<string | null>('events');
  if (clubs.isPending) return <Loading />;
  if (clubs.error) return <ErrorState error={clubs.error} retry={() => void clubs.refetch()} />;
  const club = clubs.data.find((c) => c.id === id);
  if (!club)
    return (
      <Stack>
        <Title order={1}>{tx('Club not found')}</Title>
        <Button component={Link} to="/admin/clubs" variant="subtle" w="fit-content">
          {tx('All clubs')}
        </Button>
      </Stack>
    );
  return (
    <Stack gap="lg">
      <PageHeader
        leading={
          <Avatar
            src={club.has_logo ? `/api/clubs/${club.id}/logo` : undefined}
            size={56}
            radius="md"
          >
            <IconBuilding size={26} />
          </Avatar>
        }
        eyebrow={communities.data?.find((c) => c.id === club.community_id)?.name ?? tx('Club')}
        title={club.name}
      />
      <Tabs value={tab} onChange={setTab} keepMounted={false}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="events">{tx('Events')}</Tabs.Tab>
          <Tabs.Tab value="seasons">{tx('Seasons')}</Tabs.Tab>
          <Tabs.Tab value="tiers">{tx('Skill tiers')}</Tabs.Tab>
          <Tabs.Tab value="players">{tx('Players')}</Tabs.Tab>
          <Tabs.Tab value="settings">{tx('Settings')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="events">
          <ClubEvents club={club} />
        </Tabs.Panel>
        <Tabs.Panel value="seasons">
          <ClubSeasons clubId={club.id} />
        </Tabs.Panel>
        <Tabs.Panel value="tiers">
          <ClubTiers clubId={club.id} />
        </Tabs.Panel>
        <Tabs.Panel value="players">
          <ClubPlayers clubId={club.id} />
        </Tabs.Panel>
        <Tabs.Panel value="settings">
          <ClubSettings club={club} isAdmin={user?.role === 'admin'} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
