import { useState, type ReactNode } from 'react';
import { Modal, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { promptInstall, useInstallState, type InstallState } from './install';

// iOS share glyph: a square with an arrow leaving its top.
function ShareGlyph() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: 'text-bottom' }}
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function IosHint({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  useLocale();
  return (
    <Modal opened={opened} onClose={onClose} title={tx('Install the app')} size="sm">
      <Stack gap="sm">
        {/* Safari has Share in its toolbar (iOS 26: inside the ⋯ menu); Chrome in the address bar;
            Edge and Firefox in their menu. */}
        <Text size="sm">
          1. {tx('Tap Share')} <ShareGlyph />{' '}
          {tx('in the toolbar or the address bar, or in the browser menu (⋯ or ☰)')}
        </Text>
        <Text size="sm">2. {tx('Choose "Add to Home Screen"')}</Text>
      </Stack>
    </Modal>
  );
}

/**
 * Install action shared by the header button and the phone menu.
 * `state` is 'hidden' when installing is not possible (already installed, standalone,
 * or a browser with no install path); render nothing then. Render `dialog` once next
 * to the control that calls `install`.
 */
export function useInstall(): { state: InstallState; install: () => void; dialog: ReactNode } {
  const state = useInstallState();
  const [hint, setHint] = useState(false);
  const install = () => {
    if (state === 'ios') setHint(true);
    else if (state === 'prompt') void promptInstall();
  };
  return {
    state,
    install,
    dialog: state === 'ios' ? <IosHint opened={hint} onClose={() => setHint(false)} /> : null,
  };
}
