import { Drawer, Stack, Switch, Tabs } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useState } from 'react';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { Tournament, TournamentStatus, TvSettings } from '../../types';
import { Section, SectionHelp } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import type { TournamentPrefix } from '../tournament/query';
import { AliasEditor } from './AliasEditor';
import { Collaborators } from './Collaborators';
import { CommunicateSection } from './CommunicateSection';
import { CourtsSection, MexicanoSettings } from './CourtsSection';
import { PaymentsPanel } from './PaymentsPanel';
import { RatingSection } from './RatingSection';
import { ScopeEditor } from './ScopeEditor';
import { ScoringSection, TvSection, useTvPatch } from './ScoringSection';

export type SettingsTab = 'general' | 'scoring' | 'tv' | 'courts' | 'communicate' | 'payments';

const HELP_KEY = 'amistoso-settings-help';
const readHelp = () => {
  try {
    return localStorage.getItem(HELP_KEY) !== 'off';
  } catch {
    return true;
  }
};

// The tournament settings drawer: one place for everything that used to be spread across the
// legacy Settings card. Tabs are grouped by task; the drawer is a bottom sheet on phones.
export function TournamentSettings({
  tournament,
  status,
  settings,
  prefix,
  isOwnerOrAdmin,
  initialTab = 'general',
  onClose,
}: {
  tournament: Tournament;
  status: TournamentStatus;
  settings: TvSettings;
  prefix: TournamentPrefix;
  /** Co-editors cannot manage co-editors, move the community or recalculate ELO. */
  isOwnerOrAdmin: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  useLocale();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [tab, setTab] = useState<string>(initialTab);
  const [help, setHelp] = useState(readHelp);
  const id = tournament.id;
  const invalidate = [
    ['admin', 'tournaments'],
    ['admin', 'tournament', id],
  ];
  const visibility = useAdminMutation({
    request: (value: boolean) => write(`/tournaments/${id}/public`, { public: value }, 'PATCH'),
    invalidate,
    success: 'Visibility updated',
  });
  const tvPatch = useTvPatch(id);
  const hasPlayoffs = prefix === 'po' || status.phase === 'playoffs' || prefix === 'gp';
  const sections = [
    { value: 'general', label: tx('General') },
    { value: 'scoring', label: tx('Scoring') },
    { value: 'tv', label: tx('TV screen') },
    { value: 'courts', label: prefix === 'mex' ? tx('Courts and pairing') : tx('Courts') },
    { value: 'communicate', label: tx('Email') },
    { value: 'payments', label: tx('Payments') },
  ];
  return (
    <Drawer
      opened
      onClose={onClose}
      position={phone ? 'bottom' : 'right'}
      size={phone ? '92%' : 'min(860px, 100vw)'}
      title={tx('Tournament settings')}
      padding="md"
      closeButtonProps={{ 'aria-label': tx('Close') }}
    >
      <Switch
        size="sm"
        mb="md"
        label={tx('Show help')}
        checked={help}
        onChange={(e) => {
          setHelp(e.currentTarget.checked);
          try {
            localStorage.setItem(HELP_KEY, e.currentTarget.checked ? 'on' : 'off');
          } catch {
            /* The switch still works for this visit. */
          }
        }}
      />
      <SectionHelp.Provider value={help}>
        <Tabs
          value={tab}
          onChange={(v) => setTab(v ?? 'general')}
          keepMounted={false}
          orientation={phone ? 'horizontal' : 'vertical'}
          variant={phone ? 'default' : 'pills'}
        >
          <Tabs.List
            mr={phone ? 0 : 'lg'}
            mb={phone ? 'md' : 0}
            miw={phone ? undefined : 170}
            w={phone ? '100%' : undefined}
            style={{
              alignSelf: 'flex-start',
              flexWrap: phone ? 'wrap' : undefined,
            }}
          >
            {sections.map((s) => (
              <Tabs.Tab
                key={s.value}
                value={s.value}
                style={{
                  justifyContent: 'flex-start',
                  flex: phone ? '1 1 30%' : undefined,
                  minWidth: phone ? 0 : undefined,
                  whiteSpace: phone ? 'normal' : undefined,
                }}
              >
                {s.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel flex={1} miw={0} value="general">
            <Stack gap="md">
              <Section
                title={tx('Visibility')}
                description={tx('Public events are listed on the Events page.')}
              >
                <Switch
                  label={tx('List publicly')}
                  checked={tournament.public}
                  disabled={visibility.isPending}
                  onChange={(e) => visibility.mutate(e.currentTarget.checked)}
                />
                <Switch
                  label={tx('Hide the schedule from players')}
                  description={tx(
                    'Players and the TV screen see only played matches. Groups and the bracket stay hidden until you turn this off.',
                  )}
                  checked={settings.hide_schedule ?? false}
                  disabled={tvPatch.isPending}
                  onChange={(e) => tvPatch.mutate({ hide_schedule: e.currentTarget.checked })}
                />
              </Section>
              <Section title={tx('Public address')}>
                <AliasEditor
                  base={`/tournaments/${id}`}
                  publicPath="tv"
                  alias={tournament.alias}
                  id={id}
                  invalidate={invalidate}
                />
              </Section>
              <Section
                title={tx('Community, club and season')}
                description={tx(
                  'Moving a tournament changes whose ratings and leaderboards it counts for.',
                )}
              >
                <ScopeEditor
                  base={`/tournaments/${id}`}
                  scope={{
                    community_id: tournament.community_id,
                    club_id: tournament.club_id,
                    season_id: tournament.season_id ?? null,
                  }}
                  invalidate={invalidate}
                  canMoveCommunity={isOwnerOrAdmin}
                />
              </Section>
              <Section
                title={tx('Co-editors')}
                description={tx('Other organizers who can run this tournament with you.')}
              >
                <Collaborators base={`/tournaments/${id}`} canManage={isOwnerOrAdmin} />
              </Section>
              {isOwnerOrAdmin && <RatingSection tid={id} />}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel flex={1} miw={0} value="scoring">
            <ScoringSection tid={id} prefix={prefix} settings={settings} />
          </Tabs.Panel>
          <Tabs.Panel flex={1} miw={0} value="tv">
            <TvSection
              tid={id}
              settings={settings}
              hasCourts={(status.courts?.length ?? 0) > 0}
              hasPlayoffs={hasPlayoffs}
              mexicano={prefix === 'mex'}
            />
          </Tabs.Panel>
          <Tabs.Panel flex={1} miw={0} value="courts">
            <Stack gap="md">
              <CourtsSection tid={id} prefix={prefix} status={status} />
              {prefix === 'mex' && <MexicanoSettings tid={id} status={status} />}
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel flex={1} miw={0} value="communicate">
            <CommunicateSection kind="tournament" id={id} />
          </Tabs.Panel>
          <Tabs.Panel flex={1} miw={0} value="payments">
            <PaymentsPanel base={`/tournaments/${id}`} scope="tournament" />
          </Tabs.Panel>
        </Tabs>
      </SectionHelp.Provider>
    </Drawer>
  );
}
