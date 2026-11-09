import type { ReactNode } from 'react';
import { Drawer } from '@mantine/core';

// A bottom sheet that is exactly as tall as its content (Mantine's `size="auto"` fills the screen),
// capped at 92% of the viewport and padded for the home indicator.
export function BottomDrawer({
  opened,
  onClose,
  title,
  children,
  minHeight,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Keeps the sheet from jumping in height while its content changes (search results). */
  minHeight?: string;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      title={title}
      padding="md"
      styles={{
        content: { height: 'auto', width: '100%', flex: '0 0 auto', maxHeight: '92dvh', minHeight },
        body: {
          paddingBottom: 'calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom, 0px))',
        },
      }}
    >
      {children}
    </Drawer>
  );
}
