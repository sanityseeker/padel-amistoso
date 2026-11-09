// Credentials that arrive in the address bar (email sign-in, verification and passphrase links) are
// read once, when the app boots and before the router can redirect, and stripped from the URL.
const params = new URLSearchParams(window.location.hash.slice(1));
export const linkToken = params.get('token');
export const verifyToken = params.get('verify_token');
export const participantPassphrase = params.get('participant_passphrase') || '';

if (
  (linkToken || verifyToken || participantPassphrase) &&
  window.location.pathname.startsWith('/player')
)
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
