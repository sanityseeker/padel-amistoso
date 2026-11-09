import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Input,
  NativeSelect,
  ScrollArea,
  Stack,
  Switch,
  Tabs,
  TextInput,
  Textarea,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconPlus, IconX } from '@tabler/icons-react';
import { write } from '../../api';
import { AliasEditor } from '../../admin/settings/AliasEditor';
import { Collaborators } from '../../admin/settings/Collaborators';
import { CommunicateSection } from '../../admin/settings/CommunicateSection';
import { ScopeEditor } from '../../admin/settings/ScopeEditor';
import { t as tx, useLocale } from '../../i18n';
import type { LobbyDetail, Question } from '../../types';
import { MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

const TYPES = ['text', 'choice', 'multichoice', 'number'];

function Details({ lobby }: { lobby: LobbyDetail }) {
  useLocale();
  const [form, setForm] = useState({
    name: lobby.name,
    description: lobby.description ?? '',
    message: lobby.message ?? '',
    admin_notes: lobby.admin_notes ?? '',
    join_code: lobby.join_code ?? '',
    email_requirement: lobby.email_requirement ?? 'optional',
    auto_send_email: !!lobby.auto_send_email,
    listed: lobby.listed,
  });
  const save = useAdminMutation({
    request: () =>
      write(
        `/registrations/${lobby.id}`,
        {
          name: form.name.trim(),
          description: form.description,
          clear_description: !form.description.trim(),
          message: form.message,
          clear_message: !form.message.trim(),
          admin_notes: form.admin_notes,
          join_code: form.join_code.trim() || undefined,
          clear_join_code: !form.join_code.trim() && !!lobby.join_code,
          email_requirement: form.email_requirement,
          auto_send_email: form.auto_send_email,
          listed: form.listed,
        },
        'PATCH',
      ),
    invalidate: [
      ['admin', 'lobby', lobby.id],
      ['admin', 'lobbies'],
    ],
    success: 'Lobby settings saved',
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((cur) => ({ ...cur, [key]: value }));
  return (
    <Stack gap="md">
      <Section title={tx('Lobby details')}>
        <TextInput
          label={tx('Event name')}
          maxLength={255}
          value={form.name}
          onChange={(e) => set('name', e.currentTarget.value)}
        />
        <Textarea
          label={tx('Description')}
          autosize
          minRows={2}
          maxLength={5000}
          value={form.description}
          onChange={(e) => set('description', e.currentTarget.value)}
        />
        <Textarea
          label={tx('Message to registrants')}
          description={tx('Shown on the sign-up page and used for the organizer email.')}
          autosize
          minRows={2}
          maxLength={5000}
          value={form.message}
          onChange={(e) => set('message', e.currentTarget.value)}
        />
        <Textarea
          label={tx('Private notes')}
          description={tx('Only organizers see these.')}
          autosize
          minRows={2}
          maxLength={10000}
          value={form.admin_notes}
          onChange={(e) => set('admin_notes', e.currentTarget.value)}
        />
      </Section>
      <Section title={tx('Sign-up rules')}>
        <TextInput
          label={tx('Join code')}
          description={tx('Players must enter it to sign up. Leave empty for an open sign-up.')}
          maxLength={64}
          value={form.join_code}
          onChange={(e) => set('join_code', e.currentTarget.value)}
        />
        <NativeSelect
          label={tx('Email address')}
          value={form.email_requirement}
          onChange={(e) =>
            set('email_requirement', e.currentTarget.value as 'required' | 'optional' | 'disabled')
          }
          data={[
            { value: 'optional', label: tx('Optional') },
            { value: 'required', label: tx('Required') },
            { value: 'disabled', label: tx('Not asked') },
          ]}
        />
        <Switch
          label={tx('Email login details on sign-up')}
          checked={form.auto_send_email}
          onChange={(e) => set('auto_send_email', e.currentTarget.checked)}
        />
        <Switch
          label={tx('List in public events')}
          checked={form.listed}
          onChange={(e) => set('listed', e.currentTarget.checked)}
        />
      </Section>
      <MutationError error={save.error} />
      <Group justify="flex-end">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {tx('Save settings')}
        </Button>
      </Group>
    </Stack>
  );
}

function Questions({ lobby }: { lobby: LobbyDetail }) {
  useLocale();
  const [items, setItems] = useState<Question[]>(lobby.questions);
  const save = useAdminMutation({
    request: () =>
      write(
        `/registrations/${lobby.id}`,
        {
          questions: items.map((q) => ({
            key: q.key,
            label: q.label.trim(),
            type: q.type,
            required: q.required,
            choices: q.choices.map((c) => c.trim()).filter(Boolean),
          })),
        },
        'PATCH',
      ),
    invalidate: [['admin', 'lobby', lobby.id]],
    success: 'Questions saved',
  });
  const edit = (i: number, patch: Partial<Question>) =>
    setItems((cur) => cur.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <Section
      title={tx('Sign-up questions')}
      description={tx('Extra fields on the sign-up form. Removing a question hides its answers.')}
    >
      <Stack gap="md">
        {items.map((q, i) => (
          <Stack key={q.key} gap="xs">
            <Group wrap="nowrap" align="flex-end">
              <TextInput
                flex={1}
                label={tx('Question')}
                maxLength={128}
                value={q.label}
                onChange={(e) => edit(i, { label: e.currentTarget.value })}
              />
              <NativeSelect
                aria-label={tx('Answer type')}
                value={q.type}
                onChange={(e) => edit(i, { type: e.currentTarget.value })}
                data={TYPES.map((v) => ({ value: v, label: tx(v) }))}
              />
              <ActionIcon
                color="red"
                aria-label={tx('Remove question')}
                onClick={() => setItems(items.filter((_, j) => j !== i))}
              >
                <IconX size={16} />
              </ActionIcon>
            </Group>
            {(q.type === 'choice' || q.type === 'multichoice') && (
              <Stack gap={6}>
                <Input.Label>{tx('Choices')}</Input.Label>
                {q.choices.map((c, ci) => (
                  <Group key={ci} gap="xs" wrap="nowrap">
                    <TextInput
                      flex={1}
                      aria-label={tx('Choice {n}', { n: ci + 1 })}
                      placeholder={tx('Choice {n}', { n: ci + 1 })}
                      maxLength={128}
                      value={c}
                      onChange={(e) =>
                        edit(i, {
                          choices: q.choices.map((x, k) => (k === ci ? e.currentTarget.value : x)),
                        })
                      }
                    />
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label={tx('Remove choice {n}', { n: ci + 1 })}
                      onClick={() => edit(i, { choices: q.choices.filter((_, k) => k !== ci) })}
                    >
                      <IconX size={16} />
                    </ActionIcon>
                  </Group>
                ))}
                <Button
                  variant="light"
                  size="compact-sm"
                  w="fit-content"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => edit(i, { choices: [...q.choices, ''] })}
                >
                  {tx('Add choice')}
                </Button>
              </Stack>
            )}
            <Switch
              size="xs"
              label={tx('Required')}
              checked={q.required}
              onChange={(e) => edit(i, { required: e.currentTarget.checked })}
            />
          </Stack>
        ))}
        <Button
          variant="light"
          w="fit-content"
          leftSection={<IconPlus size={15} />}
          onClick={() =>
            setItems([
              ...items,
              {
                key: `q${Date.now().toString(36)}`,
                label: '',
                type: 'text',
                required: false,
                choices: [],
              },
            ])
          }
        >
          {tx('Add question')}
        </Button>
        <MutationError error={save.error} />
        <Group justify="flex-end">
          <Button
            loading={save.isPending}
            disabled={items.some((q) => !q.label.trim())}
            onClick={() => save.mutate()}
          >
            {tx('Save questions')}
          </Button>
        </Group>
      </Stack>
    </Section>
  );
}

export function LobbySettings({ lobby, onClose }: { lobby: LobbyDetail; onClose: () => void }) {
  useLocale();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [tab, setTab] = useState('details');
  const invalidate = [
    ['admin', 'lobby', lobby.id],
    ['admin', 'lobbies'],
  ];
  return (
    <Drawer
      opened
      onClose={onClose}
      position={phone ? 'bottom' : 'right'}
      size={phone ? '92%' : 'min(560px, 100vw)'}
      title={tx('Lobby settings')}
      scrollAreaComponent={ScrollArea.Autosize}
      closeButtonProps={{ 'aria-label': tx('Close') }}
    >
      <Tabs value={tab} onChange={(v) => setTab(v ?? 'details')}>
        <Tabs.List mb="md">
          <Tabs.Tab value="details">{tx('Details')}</Tabs.Tab>
          <Tabs.Tab value="questions">{tx('Questions')}</Tabs.Tab>
          <Tabs.Tab value="address">{tx('Address and scope')}</Tabs.Tab>
          <Tabs.Tab value="team">{tx('Co-editors')}</Tabs.Tab>
          <Tabs.Tab value="email">{tx('Email')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="details">
          <Details lobby={lobby} />
        </Tabs.Panel>
        <Tabs.Panel value="questions">
          <Questions lobby={lobby} />
        </Tabs.Panel>
        <Tabs.Panel value="address">
          <Stack gap="md">
            <Section title={tx('Public address')}>
              <AliasEditor
                base={`/registrations/${lobby.id}`}
                publicPath="register"
                alias={lobby.alias}
                id={lobby.id}
                invalidate={invalidate}
              />
            </Section>
            <Section title={tx('Community, club and season')}>
              <ScopeEditor
                base={`/registrations/${lobby.id}`}
                scope={{ community_id: lobby.community_id, club_id: lobby.club_id }}
                invalidate={invalidate}
              />
            </Section>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="team">
          <Section
            title={tx('Co-editors')}
            description={tx('Other organizers who can manage this lobby.')}
          >
            <Collaborators base={`/registrations/${lobby.id}`} />
          </Section>
        </Tabs.Panel>
        <Tabs.Panel value="email">
          <CommunicateSection kind="lobby" id={lobby.id} />
        </Tabs.Panel>
      </Tabs>
    </Drawer>
  );
}
