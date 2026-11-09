import { Kbd, Modal, Table, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';
import { useShellUi } from '../../shell/ShellUi';
import { modifierLabel } from './hotkeys';

// "?" opens this. Every shortcut also has a visible control; this is the memory aid.
export function ShortcutSheet() {
  useLocale();
  const { shortcutsOpen, setShortcutsOpen } = useShellUi();
  const mod = modifierLabel();
  const rows: [string[], string][] = [
    [['Ctrl/Cmd', 'K'], tx('Command palette')],
    [[`${mod}`, '1-8'], tx('Jump to open tournament 1 to 8')],
    [['Alt', 'Up / Down'], tx('Previous or next open tournament')],
    [['Alt', 'Backspace'], tx('Back to the last tournament')],
    [['g', 't'], tx('Go to Tournaments')],
    [['g', 'l'], tx('Go to Lobbies')],
    [['g', 'n'], tx('Go to New')],
    [['g', 'c'], tx('Go to Clubs and communities')],
    [['j', 'k'], tx('Move between matches')],
    [['Enter', 's'], tx('Score the selected match')],
    [['/'], tx('Focus the match filter')],
    [['Ctrl/Cmd', 'B'], tx('Collapse or expand the dock')],
    [['?'], tx('This list')],
  ];
  return (
    <Modal
      opened={shortcutsOpen}
      onClose={() => setShortcutsOpen(false)}
      title={tx('Keyboard shortcuts')}
      size="md"
      centered
    >
      <Table verticalSpacing="xs">
        <Table.Tbody>
          {rows.map(([keys, label]) => (
            <Table.Tr key={label}>
              <Table.Td w={170}>
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' '}
                    <Kbd>{k}</Kbd>
                  </span>
                ))}
              </Table.Td>
              <Table.Td>{label}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="sm">
        {tx('Single-key shortcuts are off while you type in a field or a dialog is open.')}
      </Text>
    </Modal>
  );
}
