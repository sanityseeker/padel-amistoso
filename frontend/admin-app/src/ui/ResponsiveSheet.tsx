import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Drawer, Modal } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import classes from './ResponsiveSheet.module.css';

// While the on-screen keyboard is open the visual viewport is shorter than the layout viewport (iOS).
// The sheet shrinks to the visible part and lifts above the keyboard so Save stays reachable.
function useViewportInsets(active: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setStyle({
        '--sheet-max-height': `${Math.floor(viewport.height * 0.96)}px`,
        '--sheet-bottom-inset': `${Math.floor(inset)}px`,
      } as CSSProperties);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, [active]);
  return style;
}

// A bottom sheet on phones, a centered dialog from 768 px. Both are real dialogs (role="dialog",
// focus trap, Esc closes, focus returns to the trigger).
// The phone bottom sheet: top corners rounded, lifted above the on-screen keyboard, padded for the home
// indicator. Used by ResponsiveSheet on phones and, always, by BottomDrawer (menus).
export function PhoneSheet({
  opened,
  onClose,
  title,
  children,
  fullHeight = false,
  minHeight,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** The sheet takes the whole visible height instead of fitting its content. */
  fullHeight?: boolean;
  /** Keeps the sheet from jumping in height while its content changes (search results). */
  minHeight?: string;
}) {
  const insets = useViewportInsets(opened);
  return (
    <Drawer.Root
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      trapFocus
      returnFocus
      classNames={{
        content: classes.sheet,
        body: fullHeight ? `${classes.body} ${classes.bodyFlush}` : classes.body,
      }}
    >
      <Drawer.Overlay />
      <Drawer.Content
        style={{
          ...insets,
          height: fullHeight ? 'var(--sheet-max-height, 96dvh)' : 'auto',
          width: '100%',
          flex: '0 0 auto',
          minHeight,
        }}
        radius="lg"
      >
        <Drawer.Header>
          <Drawer.Title>{title}</Drawer.Title>
          <Drawer.CloseButton />
        </Drawer.Header>
        <Drawer.Body>{children}</Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export function ResponsiveSheet({
  opened,
  onClose,
  title,
  children,
  size = 'md',
  fullHeight = false,
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: string;
  /** On phones the sheet takes the whole visible height instead of fitting its content. */
  fullHeight?: boolean;
}) {
  const phone = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  if (phone)
    return (
      <PhoneSheet opened={opened} onClose={onClose} title={title} fullHeight={fullHeight}>
        {children}
      </PhoneSheet>
    );
  return (
    <Modal opened={opened} onClose={onClose} title={title} size={size} trapFocus returnFocus>
      {children}
    </Modal>
  );
}
