import { createContext, useContext, useState, type ReactNode } from 'react';
import { useInstall } from '../pwa/useInstall';

type Install = ReturnType<typeof useInstall>;
interface ShellUi {
  switcherOpen: boolean;
  setSwitcherOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  passwordOpen: boolean;
  setPasswordOpen: (open: boolean) => void;
  install: Install;
}

const Context = createContext<ShellUi | null>(null);

// Open/closed state of the shell's sheets and dialogs, so the header, bottom tabs, palette and
// shortcuts can all open the same single instance of each.
export function ShellUiProvider({ children }: { children: ReactNode }) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const install = useInstall();
  return (
    <Context.Provider
      value={{
        switcherOpen,
        setSwitcherOpen,
        menuOpen,
        setMenuOpen,
        shortcutsOpen,
        setShortcutsOpen,
        passwordOpen,
        setPasswordOpen,
        install,
      }}
    >
      {children}
      {install.dialog}
    </Context.Provider>
  );
}

export function useShellUi(): ShellUi {
  const value = useContext(Context);
  if (!value) throw new Error('useShellUi needs ShellUiProvider');
  return value;
}
