import { Container, type ContainerProps } from '@mantine/core';

/** The width and vertical padding of every public and player page: compact on phones, roomier from
 *  `sm`. Pages pass only `size` when they need a narrower column. */
export function PageContainer({
  size = 'md',
  ...props
}: ContainerProps & { 'data-testid'?: string }) {
  return <Container size={size} py={{ base: 'sm', sm: 'lg' }} {...props} />;
}
