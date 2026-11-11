import type { ReactNode } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Progress,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
  VisuallyHidden,
} from '@mantine/core';
import { IconArrowRight, IconDots, IconSettings, IconTrophy } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { PhaseBadge } from '../../components';
import { StatusBadge } from '../../ui';
import classes from './Workspace.module.css';

export interface NextStep {
  label: string;
  onClick: () => void;
  /** Why the step is not available yet; the button stays visible but disabled with this tooltip. */
  disabledReason?: string;
}
export interface MenuEntry {
  key: string;
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  /** Window name for `href`: the link opens in that window instead of replacing this page. */
  target?: string;
  color?: string;
  /** Draw a divider before this entry. */
  divider?: boolean;
}

export function NextStepButton({ step, full }: { step: NextStep; full?: boolean }) {
  return (
    <Tooltip label={step.disabledReason} disabled={!step.disabledReason || full} withArrow>
      <span style={full ? { display: 'block', width: '100%' } : undefined}>
        <Button
          size="touch"
          fullWidth={full}
          rightSection={<IconArrowRight size={16} />}
          disabled={!!step.disabledReason}
          data-disabled-reason={step.disabledReason}
          onClick={step.onClick}
        >
          {step.label}
        </Button>
        {/* Touch screens have no hover: the reason is printed under the full-width button. */}
        {full && step.disabledReason && (
          <Text size="xs" c="dimmed" ta="center" mt={4} data-testid="next-step-reason">
            {step.disabledReason}
          </Text>
        )}
      </span>
    </Tooltip>
  );
}

// The sticky context header of a tournament, kept thin: title, status and "round · played" on one row,
// the round or phase control and the actions beside them, and a 3 px progress line. Phones drop the
// visible title (the top bar already shows the name) and keep the next step in the action bar.
export function WorkspaceHeader({
  name,
  eyebrow,
  phase,
  phaseBar,
  roundText,
  played,
  total,
  reviewCount,
  onReview,
  next,
  menu,
  phone,
  champion,
}: {
  name: string;
  eyebrow: string;
  phase: string;
  /** PhaseStepper or RoundBar (both compact, inline). */
  phaseBar: ReactNode;
  roundText?: string | null;
  played: number;
  total: number;
  reviewCount: number;
  onReview: () => void;
  next: NextStep | null;
  menu: MenuEntry[];
  phone: boolean;
  champion?: string[] | null;
}) {
  useLocale();
  const settingsEntry = menu.find((entry) => entry.key === 'settings');
  return (
    <div className={classes.header} data-testid="workspace-header">
      <Group justify="space-between" align="center" wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="wrap" align="baseline" miw={0} className={classes.headLine}>
          {/* The dock, open tabs or phone chip already name the event; keep the h1 for screen readers. */}
          <VisuallyHidden>
            <Title order={1} title={eyebrow}>
              {name}
            </Title>
          </VisuallyHidden>
          <PhaseBadge phase={phase} />
          {reviewCount > 0 && (
            <UnstyledButton type="button" onClick={onReview}>
              <StatusBadge tone="danger">{tx('{n} to review', { n: reviewCount })}</StatusBadge>
            </UnstyledButton>
          )}
          <Text size="sm" component="span" className={classes.meta}>
            {roundText && <span>{roundText}</span>}
            {roundText && ' · '}
            <span aria-label={tx('Matches played')}>
              <Text span variant="score" fz="inherit">
                {played} / {total}
              </Text>{' '}
              {tx('played')}
            </span>
          </Text>
          {champion && champion.length > 0 && (
            <span title={tx('Tournament champions')}>
              <StatusBadge tone="info" leftSection={<IconTrophy size={12} />}>
                {tx('Champions: {names}', { names: champion.join(' & ') })}
              </StatusBadge>
            </span>
          )}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {!phone && phaseBar}
          {!phone && next && <NextStepButton step={next} />}
          {settingsEntry && (
            <ActionIcon aria-label={settingsEntry.label} onClick={settingsEntry.onClick}>
              <IconSettings size={20} />
            </ActionIcon>
          )}
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon aria-label={tx('Workspace menu')}>
                <IconDots size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {menu
                .filter((entry) => entry.key !== 'settings')
                .map((entry) => (
                  <div key={entry.key}>
                    {entry.divider && <Menu.Divider />}
                    <Menu.Item
                      color={entry.color}
                      leftSection={entry.icon}
                      {...(entry.href
                        ? {
                            component: 'a' as const,
                            href: entry.href,
                            ...(entry.target ? { target: entry.target, rel: 'noopener' } : {}),
                          }
                        : { onClick: entry.onClick })}
                    >
                      {entry.label}
                    </Menu.Item>
                  </div>
                ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {phone && <div className={classes.phaseRow}>{phaseBar}</div>}
      <Progress
        value={total ? Math.round((played / total) * 100) : 0}
        size={3}
        radius={0}
        color="var(--sport-accent)"
        mt={6}
        aria-label={tx('Matches played')}
      />
    </div>
  );
}
