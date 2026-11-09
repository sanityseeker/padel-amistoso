import { useState } from 'react';
import { Alert, Switch } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { t as tx, useLocale } from '../../../i18n';
import { playerApi } from '../../../player/api';

const KEY = (tid: string) => `padel-push-${tid}`;
const read = (tid: string) => {
  try {
    return localStorage.getItem(KEY(tid)) === '1';
  } catch {
    return false;
  }
};
const write = (tid: string, on: boolean) => {
  try {
    if (on) localStorage.setItem(KEY(tid), '1');
    else localStorage.removeItem(KEY(tid));
  } catch {
    /* The subscription itself lives on the server and in the browser. */
  }
};
function keyBytes(base64: string) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

// Web push for one tournament, as in the legacy TV page: GET push/vapid-key (no token), then
// POST push/subscribe or push/unsubscribe with the tournament token from /player-auth.
export function PushToggle({
  tid,
  token,
  label,
}: {
  tid: string;
  token: string | null;
  label?: string;
}) {
  useLocale();
  const [on, setOn] = useState(() => read(tid));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!pushSupported())
    return (
      <Alert color="gray" variant="light">
        {tx('This browser does not support push notifications.')}
      </Alert>
    );
  const toggle = async (next: boolean) => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      if (next) {
        const key = await playerApi<{ public_key: string | null }>(
          `/tournaments/${tid}/push/vapid-key`,
          undefined,
          'GET',
          null,
        );
        if (!key.public_key) throw new Error(tx('Notifications are not set up on this server.'));
        if ((await Notification.requestPermission()) !== 'granted')
          throw new Error(tx('Notifications are blocked in this browser.'));
        const registration = await navigator.serviceWorker.ready;
        const sub = (
          await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyBytes(key.public_key),
          })
        ).toJSON();
        await playerApi(
          `/tournaments/${tid}/push/subscribe`,
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
          'POST',
          token,
        );
        write(tid, true);
        setOn(true);
        notifications.show({ message: tx('Notifications are on.'), color: 'green' });
      } else {
        try {
          await playerApi(`/tournaments/${tid}/push/unsubscribe`, undefined, 'POST', token);
        } catch {
          /* Best effort: the local subscription is removed anyway. */
        }
        write(tid, false);
        setOn(false);
        try {
          const registration = await navigator.serviceWorker.ready;
          await (await registration.pushManager.getSubscription())?.unsubscribe();
        } catch {
          /* Nothing to unsubscribe. */
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Switch
        label={label ?? tx('Notify me about my matches')}
        checked={on}
        disabled={busy || !token}
        onChange={(e) => void toggle(e.currentTarget.checked)}
      />
      {error && (
        <Alert color="red" mt="xs">
          {error}
        </Alert>
      )}
    </>
  );
}
