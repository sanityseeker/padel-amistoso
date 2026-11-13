import type { ReactNode } from 'react';
import { PhoneSheet } from './ResponsiveSheet';

// A bottom sheet that is exactly as tall as its content, on every screen size. It is the phone
// branch of ResponsiveSheet, so menus and forms share corners, keyboard handling and padding.
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
    <PhoneSheet opened={opened} onClose={onClose} title={title} minHeight={minHeight}>
      {children}
    </PhoneSheet>
  );
}
