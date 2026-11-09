import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { Group, Stack, Text, Title, VisuallyHidden } from '@mantine/core';
import { useLocale } from '../i18n';

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

export function PageHeader({
  title,
  description,
  keepDescription,
  eyebrow,
  actions,
  compactActions,
}: {
  title: string;
  description?: ReactNode;
  /** The subtitle carries data, so it stays when the top bar shows the title. */
  keepDescription?: boolean;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  /** A small icon action stays beside the title instead of wrapping under it on a phone. */
  compactActions?: boolean;
}) {
  useLocale();
  const inBar = useContext(TopBarTitleContext);
  const heading = inBar ? (
    <VisuallyHidden>
      <Title order={1}>{title}</Title>
    </VisuallyHidden>
  ) : (
    <Title order={1}>{title}</Title>
  );
  const showDescription = !!description && (!inBar || keepDescription);
  const showText = !inBar || showDescription || !!eyebrow;
  if (inBar && !showText && !actions) return heading;
  return (
    <Group
      justify={showText ? 'space-between' : 'flex-end'}
      align={compactActions ? 'flex-start' : 'flex-end'}
      wrap={compactActions ? 'nowrap' : undefined}
      mb={inBar ? 'xs' : 'xl'}
      gap="md"
    >
      {showText ? (
        <Stack gap={6} miw={0}>
          {eyebrow && <Text variant="eyebrow">{eyebrow}</Text>}
          {heading}
          {showDescription && <Text c="dimmed">{description}</Text>}
        </Stack>
      ) : (
        heading
      )}
      {actions}
    </Group>
  );
}
