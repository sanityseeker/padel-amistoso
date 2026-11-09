// Facts the server writes into the page shell as <meta> tags (see backend/api/__init__.py): the club a
// subdomain belongs to, and where "home" is for a 404 page. Nothing else reads the DOM for them.
export function readMeta(name: string): string | null {
  const value = document.querySelector(`meta[name="${name}"]`)?.getAttribute('content');
  return value ? value : null;
}

/** The club slug of a club subdomain, as resolved by the server; null on any other host. */
export const hostClubSlug = () => readMeta('amistoso-club');
