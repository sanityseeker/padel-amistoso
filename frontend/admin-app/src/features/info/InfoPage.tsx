import { Anchor, Group, Paper, Stack, Text, Title, VisuallyHidden } from '@mantine/core';
import { IconBrandGithub, IconBug } from '@tabler/icons-react';
import { currentLanguage, t as tx, useLocale } from '../../i18n';
import { isDemoInstance } from '../../shell/env';
import { PageHeader } from '../../ui';
import { BracketSchemaTool } from './BracketSchemaTool';
import { CATALOG, SECTIONS, catalogFor } from './catalog';
import { InfoContent } from './InfoContent';

const GITHUB = 'https://github.com/sanityseeker/padel-amistoso';
const TOC: [string, string][] = [
  ['info-at-a-glance', 'txt_txt_info_toc_glance'],
  ['info-quickstart', 'txt_txt_info_toc_quickstart'],
  ['info-demo', 'txt_txt_info_toc_demo'],
  ['info-player-flow', 'txt_txt_info_toc_player_flow'],
  ['info-admin-flow', 'txt_txt_info_toc_admin_flow'],
  ['info-main-features', 'txt_txt_info_toc_main_features'],
  ['info-communities-clubs', 'txt_txt_info_toc_communities_clubs'],
  ['info-formats', 'txt_txt_info_toc_formats'],
  ['info-elo', 'txt_txt_info_toc_elo'],
  ['info-po-transition', 'txt_txt_info_toc_po_transition'],
  ['info-schema', 'txt_txt_tournament_bracket_schema'],
  ['info-help', 'txt_txt_info_help_title'],
];

// What the app does and where each function lives: the legacy Info tab, with the same text in both
// languages, plus the bracket schema generator. The text is a static first-party catalog (catalog.ts).
export function InfoPage() {
  useLocale();
  const words = catalogFor(currentLanguage());
  const demo = isDemoInstance();
  const text = (key: string) => words[key] ?? CATALOG.en[key] ?? key;
  return (
    <Stack gap="lg" data-testid="info-page">
      <PageHeader title={text('txt_txt_info')} description={text('txt_txt_info_tab_desc')} />
      <Paper p="md" component="nav" aria-label={text('txt_txt_info_toc_title')}>
        <VisuallyHidden>{text('txt_txt_info_toc_title')}</VisuallyHidden>
        <Group gap="md" component="ol" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {TOC.map(([id, key]) => (
            <li key={id}>
              <Anchor href={`#${id}`} size="sm">
                {text(key)}
              </Anchor>
            </li>
          ))}
        </Group>
      </Paper>
      {SECTIONS.filter((s) => s.title && s.id !== 'info-intro').map((section) => (
        <Paper key={section.id} id={section.id} p="lg" component="section">
          <Title order={2} mb="sm">
            {text(section.title!)}
          </Title>
          <InfoContent section={section} demo={demo} />
        </Paper>
      ))}
      <Paper p="lg" id="info-schema" component="section">
        <Title order={2} mb="xs">
          {text('txt_txt_tournament_bracket_schema')}
        </Title>
        <Text c="dimmed" mb="md">
          {tx('Generate a diagram of the tournament structure before you create the event.')}
        </Text>
        <BracketSchemaTool />
      </Paper>
      <Paper p="lg" id="info-help" component="section">
        <Title order={2} mb="sm">
          {text('txt_txt_info_help_title')}
        </Title>
        <Stack gap="xs">
          <Anchor href={GITHUB} target="_blank" rel="noopener">
            <Group gap={6}>
              <IconBrandGithub size={16} />
              {text('txt_txt_info_github_link')}
            </Group>
          </Anchor>
          <Text size="sm" c="dimmed">
            {text('txt_txt_info_issue_prefix')}{' '}
            <Anchor href={`${GITHUB}/issues/new`} target="_blank" rel="noopener">
              <IconBug size={14} style={{ verticalAlign: '-2px' }} />{' '}
              {text('txt_txt_info_issue_link')}
            </Anchor>
            .
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
