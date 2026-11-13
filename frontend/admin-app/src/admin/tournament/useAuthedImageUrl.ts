import { useEffect, useState } from 'react';
import { TOKEN_KEY } from '../../api';

/**
 * Object URL of an image that needs the organizer's token (a plain <img> cannot send it).
 * Returns null while loading or when the request fails. The URL is revoked on unmount.
 */
export function useAuthedImageUrl(url: string): string | null {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let created: string | null = null;
    setBlobUrl(null);
    const headers = new Headers();
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    fetch(url, { headers, signal: controller.signal })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || controller.signal.aborted) return;
        created = URL.createObjectURL(blob);
        setBlobUrl(created);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);
  return blobUrl;
}
