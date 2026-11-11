import { useRef, useState } from 'react';
import { Button, Group, Modal, PasswordInput, Stack } from '@mantine/core';
import { ApiError, write } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import { PasswordPair } from './PasswordPair';
import { accountError, ErrorAlert, mismatchProblem, passwordProblem } from './shared';
import { Notice } from '../../ui/Notice';

function Form({ onClose }: { onClose: () => void }) {
  const { user, username: remembered } = useAuth();
  const username = user?.username || remembered;
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (done)
    return (
      <Stack>
        <Notice tone="success" role="status">
          {tx('Your password has been changed.')}
        </Notice>
        <Group justify="flex-end">
          <Button onClick={onClose} autoFocus>
            {tx('Close')}
          </Button>
        </Group>
      </Stack>
    );

  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        setTouched(true);
        if (!current) return currentRef.current?.focus();
        if (passwordProblem(password) || !password) return passwordRef.current?.focus();
        if (mismatchProblem(password, confirm) || !confirm) return confirmRef.current?.focus();
        setError('');
        setBusy(true);
        try {
          // The password endpoint does not check the old password, so prove it with a login first.
          try {
            await write('/auth/login', { username, password: current });
          } catch (e) {
            if (e instanceof ApiError && e.status === 401) {
              setError(tx('The current password is not correct.'));
              currentRef.current?.focus();
              return;
            }
            throw e;
          }
          await write(
            `/auth/users/${encodeURIComponent(username)}/password`,
            { new_password: password },
            'PATCH',
          );
          setDone(true);
        } catch (e) {
          setError(accountError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Stack>
        <ErrorAlert error={error} />
        <PasswordInput
          ref={currentRef}
          data-autofocus
          label={tx('Current password')}
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.currentTarget.value)}
        />
        <PasswordPair
          password={password}
          confirm={confirm}
          touched={touched}
          onPassword={setPassword}
          onConfirm={setConfirm}
          onTouched={() => setTouched(true)}
          passwordRef={passwordRef}
          confirmRef={confirmRef}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {tx('Cancel')}
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {tx('Change password')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

export function ChangePasswordModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  useLocale();
  return (
    <Modal opened={opened} onClose={onClose} title={tx('Change password')} keepMounted={false}>
      <Form onClose={onClose} />
    </Modal>
  );
}
