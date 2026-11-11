import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Anchor, Group, Stack, Text, Title, VisuallyHidden } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n';
import classes from './PageHeader.module.css';

/** True when the shell top bar already shows this page's title. */
export const TopBarTitleContext = createContext(false);
export const TopBarActionContext = createContext<{
  action: ReactNode;
  setAction: Dispatch<SetStateAction<ReactNode>>;
}>({ action: null, setAction: () => undefined });

export function TopBarAction({ children }: { children: ReactNode }) {
  const { setAction } = useContext(TopBarActionContext);
  useEffect(() => {
    setAction(children);
    return () => setAction(null);
  }, [children, setAction]);
  return null;
}

/** A header link: the back link and secondary actions such as "Full event view". In-app with `to`,
 *  a plain page link with `href`. Same size, weight and icon spacing everywhere. */
export function PageLink({
  to,
  href,
  leftIcon,
  rightIcon,
  children,
}: {
  to?: string;
  href?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children: ReactNode;
}) {
  const content = (
    <>
      {leftIcon}
      {children}
      {rightIcon}
    </>
  );
  return to ? (
    <Anchor component={Link} to={to} size="sm" fw={600} className={classes.link}>
      {content}
    </Anchor>
  ) : (
    <Anchor href={href} size="sm" fw={600} className={classes.link}>
      {content}
    </Anchor>
  );
}

// One header for every page, top to bottom: back link, eyebrow, title, a meta row (status badges and
// secondary links), the description; primary actions sit beside it. Notices go under it.
// The title is one size rule: compact on phones, full from the `sm` breakpoint (PageHeader.module.css).
// The header adds no outer margin: the parent Stack sets the gap below it.
export function PageHeader({
  title,
  description,
  keepDescription,
  eyebrow,
  actions,
  compactActions,
  dense,
  back,
  meta,
  leading,
}: {
  title: string;
  description?: ReactNode;
  /** The subtitle carries data, so it stays when the top bar shows the title. */
  keepDescription?: boolean;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** A small icon action stays beside the title instead of wrapping under it on a phone. */
  compactActions?: boolean;
  /** Tight phone header: title, then the subtitle and actions on one line. */
  dense?: boolean;
  /** The parent page, as a small link above the eyebrow. */
  back?: { to: string; label: string };
  /** A row under the title: status badges and secondary links (PageLink). */
  meta?: ReactNode;
  /** A mark beside the text block, such as a club logo. */
  leading?: ReactNode;
}) {
  useLocale();
  const inBar = useContext(TopBarTitleContext);
  const heading = inBar ? (
    <VisuallyHidden>
      <Title order={1}>{title}</Title>
    </VisuallyHidden>
  ) : (
    <Title order={1} className={classes.title}>
      {title}
    </Title>
  );
  const showDescription = !!description && (!inBar || keepDescription);
  const showText = !inBar || showDescription || !!eyebrow || !!back || !!meta;
  if (inBar && !showText && !actions) return heading;
  const backLink = back && (
    <PageLink to={back.to} leftIcon={<IconArrowLeft size={14} aria-hidden />}>
      {back.label}
    </PageLink>
  );
  const metaRow = meta && (
    <Group gap="sm" wrap="wrap" align="center" mt={2}>
      {meta}
    </Group>
  );
  if (dense && !inBar)
    return (
      <Stack gap={6} miw={0}>
        {backLink}
        <Stack gap={2} miw={0}>
          {eyebrow && <Text variant="eyebrow">{eyebrow}</Text>}
          {heading}
        </Stack>
        {metaRow}
        {(showDescription || actions) && (
          <Group gap="xs" wrap="nowrap" align="center">
            {showDescription && (
              <Text c="dimmed" lineClamp={1} miw={0}>
                {description}
              </Text>
            )}
            {actions}
          </Group>
        )}
      </Stack>
    );
  return (
    <Group
      justify={showText ? 'space-between' : 'flex-end'}
      align={compactActions ? 'flex-start' : 'flex-end'}
      wrap={compactActions ? 'nowrap' : undefined}
      gap="md"
    >
      {showText ? (
        <Group gap="md" wrap="nowrap" miw={0}>
          {leading}
          <Stack gap={6} miw={0}>
            {backLink}
            {eyebrow && <Text variant="eyebrow">{eyebrow}</Text>}
            {heading}
            {metaRow}
            {showDescription && <Text c="dimmed">{description}</Text>}
          </Stack>
        </Group>
      ) : (
        heading
      )}
      {actions}
    </Group>
  );
}
