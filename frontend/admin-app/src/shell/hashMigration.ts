// The first React admin used HashRouter ("/admin#/tournaments/<id>"). Map those
// bookmarks to the path routes before the router starts. Only hashes beginning
// with "#/" on "/" or "/admin" are touched: "/player#token=..." email links and
// every other hash stay exactly as they are.
export function migrateHashRoute(location: Location = window.location): string | null {
  const { pathname, hash, search } = location;
  if ((pathname !== '/' && pathname !== '/admin') || !hash.startsWith('#/')) return null;
  const rest = hash.slice(1).replace(/\/+$/, '');
  const [first = '', second = '', ...tail] = rest.split('/').filter(Boolean);
  let target: string;
  if (first === 'tournaments' && second) target = `/admin/t/${second}`;
  else if (first === 'registrations' && second) target = `/admin/lobby/${second}`;
  else if (first === 'registrations') target = '/admin/lobbies';
  else if (first === 'create') target = '/admin/new';
  else if (!first || first === 'tournaments') target = '/admin';
  else target = `/admin/${[first, second, ...tail].filter(Boolean).join('/')}`;
  return target + search;
}

export function applyHashMigration() {
  const target = migrateHashRoute();
  if (target) window.history.replaceState(null, '', target);
}
