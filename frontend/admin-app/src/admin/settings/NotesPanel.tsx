import { useState } from 'react';
import { Button, Group, Stack, Textarea } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx } from '../../i18n';
import { MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

interface Notes {
  admin_notes: string | null;
}

const tournamentNotesKey = (tid: string) => ['admin', 'tournament-notes', tid];

// The organizer's private notepad, shared by the tournament and lobby Notes tabs. Editors only;
// the notes never reach players, the TV page or exports.
function NotesEditor({
  saved,
  save,
}: {
  saved: string;
  save: ReturnType<typeof useAdminMutation<string, unknown>>;
}) {
  // `null` while untouched, so the text follows the saved notes until the organizer types.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const dirty = value !== saved;
  return (
    <Stack gap="sm" maw={720}>
      <Textarea
        label={tx('Private notes')}
        description={tx('Only organizers see these.')}
        autosize
        minRows={6}
        maxLength={10000}
        value={value}
        onChange={(e) => setDraft(e.currentTarget.value)}
      />
      <MutationError error={save.error} />
      <Group justify="flex-end" gap="xs">
        {dirty && (
          <Button variant="subtle" onClick={() => setDraft(null)} disabled={save.isPending}>
            {tx('Cancel')}
          </Button>
        )}
        <Button
          onClick={() => save.mutate(value, { onSuccess: () => setDraft(null) })}
          disabled={!dirty}
          loading={save.isPending}
        >
          {tx('Save')}
        </Button>
      </Group>
    </Stack>
  );
}

export function TournamentNotes({ tid }: { tid: string }) {
  const client = useQueryClient();
  const notes = useQuery({
    queryKey: tournamentNotesKey(tid),
    queryFn: () => api<Notes>(`/tournaments/${tid}/notes`),
  });
  const save = useAdminMutation<string, unknown>({
    request: (text) => write<Notes>(`/tournaments/${tid}/notes`, { admin_notes: text }, 'PUT'),
    success: 'Notes saved',
    onSuccess: (result) => client.setQueryData(tournamentNotesKey(tid), result),
  });
  if (notes.isPending) return <Loading />;
  if (notes.isError) return <ErrorState error={notes.error} />;
  return <NotesEditor saved={notes.data.admin_notes ?? ''} save={save} />;
}

// A lobby's notes come with the lobby itself; saving patches only that field.
export function LobbyNotes({
  lobbyId,
  notes,
}: {
  lobbyId: string;
  notes: string | null | undefined;
}) {
  const client = useQueryClient();
  const save = useAdminMutation<string, unknown>({
    // Wait for the reloaded lobby, so the box never flashes the old text after saving.
    request: async (text) => {
      await write(`/registrations/${lobbyId}`, { admin_notes: text }, 'PATCH');
      await client.refetchQueries({ queryKey: ['admin', 'lobby', lobbyId] });
    },
    success: 'Notes saved',
  });
  return <NotesEditor saved={notes ?? ''} save={save} />;
}
