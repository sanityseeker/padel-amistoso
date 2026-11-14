import { notifications } from '@mantine/notifications';
import { t as tx } from '../i18n';

/** Copies text and confirms with a toast (`done`, e.g. "Codes copied", "Link copied"). */
export async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    notifications.show({ message: done, color: 'green', autoClose: 2500 });
  } catch {
    notifications.show({ message: tx('Copy is not available in this browser.'), color: 'red' });
  }
}
