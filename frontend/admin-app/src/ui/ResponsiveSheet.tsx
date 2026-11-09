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
export function ResponsiveSheet({
  opened,
  onClose,
  title,
  children,
  size = 'md',
}: {
  opened: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  size?: string;
}) {
  const phone = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const insets = useViewportInsets(opened && !!phone);
  if (phone)
    return (
      <Drawer.Root
        opened={opened}
        onClose={onClose}
        position="bottom"
        size="auto"
        trapFocus
        returnFocus
        classNames={{ content: classes.sheet, body: classes.body }}
      >
        <Drawer.Overlay />
        <Drawer.Content
          style={{ ...insets, height: 'auto', width: '100%', flex: '0 0 auto' }}
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
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      centered
      size={size}
      trapFocus
      returnFocus
    >
      {children}
    </Modal>
  );
}
