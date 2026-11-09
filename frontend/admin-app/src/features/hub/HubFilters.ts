import { useState } from 'react';

// Filters persist under the same `amistoso-home-*` keys the earlier hub used.
const key = (name: string) => `amistoso-home-${name}`;
function saved(name: string, fallback: string) {
  try {
    return localStorage.getItem(key(name)) || fallback;
  } catch {
    return fallback;
  }
}

export function useStoredFilter(name: string, fallback: string) {
  const [value, setValue] = useState(() => saved(name, fallback));
  return [
    value,
    (next: string) => {
      setValue(next);
      try {
        localStorage.setItem(key(name), next);
      } catch {
        /* The filter still works for this visit. */
      }
    },
  ] as const;
}
