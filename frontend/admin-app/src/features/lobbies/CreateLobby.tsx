import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Fieldset,
  Input,
  SegmentedControl,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { write } from '../../api';
import { useAuth } from '../../auth';
import { useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import { MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { defaultTitle } from '../create/rules';
import { ScopeFields } from '../create/ScopeFields';

// A registration lobby: a shareable sign-up page that later converts into a tournament.
export function CreateLobby({ onDone }: { onDone?: () => void }) {
  useLocale();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sport, setSport] = useState('padel');
  const [community, setCommunity] = useState(user?.default_community_id || 'open');
  const [club, setClub] = useState<string | null>(null);
  const [listed, setListed] = useState(true);
  const { clubs } = useOverview();
  const suggested = defaultTitle('lobby', sport, clubs.data?.find((c) => c.id === club)?.name);
  const lastSuggested = useRef('');
  useEffect(() => {
    const previous = lastSuggested.current;
    lastSuggested.current = suggested;
    setName((current) => (!current || current === previous ? suggested : current));
  }, [suggested]);
  const create = useAdminMutation({
    request: () =>
      write<{ id: string }>('/registrations', {
        name,
        description,
        sport,
        community_id: community,
        club_id: club,
        listed,
        auto_send_email: false,
      }),
    invalidate: [['admin', 'lobbies']],
    onSuccess: (lobby) => {
      onDone?.();
      navigate(`/admin/lobby/${lobby.id}`);
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Stack gap="lg">
        <MutationError error={create.error} />
        <Fieldset legend={tx('Basics')}>
          <Stack>
            <TextInput
              label={tx('Event name')}
              required
              maxLength={255}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Textarea
              label={tx('Description')}
              description={tx('Shown on the sign-up page. Markdown formatting is supported.')}
              autosize
              minRows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.currentTarget.value)}
            />
            <Input.Wrapper label={tx('Sport')}>
              <SegmentedControl
                fullWidth
                mt={4}
                aria-label={tx('Sport')}
                value={sport}
                onChange={(v) => setSport(v)}
                data={[
                  { value: 'padel', label: tx('Padel') },
                  { value: 'tennis', label: tx('Tennis') },
                ]}
              />
            </Input.Wrapper>
          </Stack>
        </Fieldset>
        <Fieldset legend={tx('Where it belongs')}>
          <Stack>
            <ScopeFields
              community={community}
              setCommunity={setCommunity}
              club={club}
              setClub={setClub}
            />
          </Stack>
        </Fieldset>
        <Fieldset legend={tx('Visibility')}>
          <Switch
            label={tx('List in public events')}
            checked={listed}
            onChange={(e) => setListed(e.currentTarget.checked)}
          />
        </Fieldset>
        <Button type="submit" loading={create.isPending} size="md" w="fit-content">
          {tx('Create lobby')}
        </Button>
      </Stack>
    </form>
  );
}
