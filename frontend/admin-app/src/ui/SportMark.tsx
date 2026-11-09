import { ColorSwatch, Group, Text } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { sportOf, sportProps } from '../theme';

// A sport is a small swatch plus its name, not a badge.
export function SportMark({ sport, size = 'sm' }: { sport: string; size?: 'xs' | 'sm' | 'md' }) {
  useLocale();
  const tennis = sportOf(sport) === 'tennis';
  return (
    <Group component="span" gap={6} wrap="nowrap" display="inline-flex" {...sportProps(sport)}>
      <ColorSwatch size={8} withShadow={false} color="var(--sport-accent)" aria-hidden />
      <Text span size={size}>
        {tennis ? tx('Tennis') : tx('Padel')}
      </Text>
    </Group>
  );
}
