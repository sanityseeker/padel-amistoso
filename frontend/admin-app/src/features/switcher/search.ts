// Small fuzzy matcher shared by the command palette and the phone switcher sheet. It works on
// data already in memory, so typing never causes a request.
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function tokenScore(token: string, field: string): number {
  if (!field) return 0;
  if (field === token) return 100;
  if (field.startsWith(token)) return 60;
  if (field.split(/[\s\-_/·.]+/).some((word) => word.startsWith(token))) return 40;
  if (field.includes(token)) return 25;
  // Subsequence ("gsm" finds "Gracia Sunday Mexicano"), only for tokens of 3+ letters.
  if (token.length >= 3) {
    let at = 0;
    for (const ch of field) if (ch === token[at] && ++at === token.length) return 8;
  }
  return 0;
}

/** 0 means "no match". Every word of the query must match one of the fields. An exact id match wins. */
export function matchScore(query: string, fields: string[], id?: string): number {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  if (id && fold(id) === fold(query.trim())) return 1000;
  const folded = fields.map(fold);
  let total = 0;
  for (const token of tokens) {
    const best = Math.max(0, ...folded.map((f, i) => tokenScore(token, f) * (i === 0 ? 1.5 : 1)));
    if (!best) return 0;
    total += best;
  }
  return total;
}
