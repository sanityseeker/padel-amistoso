import { useState } from 'react';
import { Button, Checkbox, NativeSelect, Select, Stack, TextInput } from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { Question, Registrant } from '../../types';
import { FormActions, MutationError, ResponsiveSheet } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

// Add a registrant, or edit one (name, email, language, answers). PATCH only sends what changed.
// A multi-choice answer is stored as a JSON list of the picked choices.
function pickedChoices(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    // an older plain-text answer
  }
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
}

export function RegistrantSheet({
  lobbyId,
  questions,
  registrant,
  onClose,
}: {
  lobbyId: string;
  questions: Question[];
  registrant?: Registrant;
  onClose: () => void;
}) {
  useLocale();
  const [name, setName] = useState(registrant?.player_name ?? '');
  const [email, setEmail] = useState(registrant?.email ?? '');
  const [lang, setLang] = useState(registrant?.lang ?? 'en');
  const [answers, setAnswers] = useState<Record<string, string>>(registrant?.answers ?? {});
  const save = useAdminMutation({
    request: () =>
      registrant
        ? write(
            `/registrations/${lobbyId}/registrant/${registrant.player_id}`,
            {
              player_name: name.trim(),
              email: email.trim(),
              lang,
              answers,
            },
            'PATCH',
          )
        : write(`/registrations/${lobbyId}/registrant`, {
            player_name: name,
            email,
            answers,
          }),
    invalidate: [
      ['admin', 'lobby', lobbyId],
      ['admin', 'lobbies'],
    ],
    success: registrant ? 'Player updated' : 'Player added',
    onSuccess: onClose,
  });
  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={registrant ? tx('Edit player') : tx('Add a player')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack>
          <MutationError error={save.error} />
          <TextInput
            label={tx('Player name')}
            required
            maxLength={128}
            data-autofocus
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label={tx('Email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          {registrant && (
            <NativeSelect
              label={tx('Email language')}
              value={lang}
              onChange={(e) => setLang(e.currentTarget.value)}
              data={[
                { value: 'en', label: 'English' },
                { value: 'es', label: 'Español' },
                { value: 'ru', label: 'Русский' },
              ]}
            />
          )}
          {questions.map((q) =>
            q.type === 'choice' ? (
              <Select
                key={q.key}
                label={q.label}
                required={q.required}
                data={q.choices}
                clearable={!q.required}
                value={answers[q.key] || null}
                onChange={(v) => setAnswers({ ...answers, [q.key]: v || '' })}
              />
            ) : q.type === 'multichoice' ? (
              <Checkbox.Group
                key={q.key}
                label={q.label}
                required={q.required}
                value={pickedChoices(answers[q.key])}
                onChange={(v) =>
                  setAnswers({ ...answers, [q.key]: v.length ? JSON.stringify(v) : '' })
                }
              >
                <Stack gap={6} mt={4}>
                  {q.choices.map((c) => (
                    <Checkbox key={c} value={c} label={c} />
                  ))}
                </Stack>
              </Checkbox.Group>
            ) : (
              <TextInput
                key={q.key}
                label={q.label}
                required={q.required}
                type={q.type === 'number' ? 'number' : 'text'}
                value={answers[q.key] || ''}
                onChange={(e) => setAnswers({ ...answers, [q.key]: e.currentTarget.value })}
              />
            ),
          )}
          <FormActions onCancel={onClose}>
            <Button type="submit" loading={save.isPending}>
              {registrant ? tx('Save') : tx('Add player')}
            </Button>
          </FormActions>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}
