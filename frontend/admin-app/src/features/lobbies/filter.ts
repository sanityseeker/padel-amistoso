import type { Question, Registrant } from '../../types';

// The final participant filter of a lobby: conditions on the answers (AND-ed) decide who may take part.
// The shapes match FilterConditionDef in the API, and `matches` mirrors the server's
// `_answer_matches_condition`, so the live preview agrees with the saved result.
export type FilterOp = 'any_of' | 'contains' | 'range' | 'answered';
export interface FilterCondition {
  key: string;
  op: FilterOp;
  values?: string[];
  text?: string;
  min_value?: number | null;
  max_value?: number | null;
}

/** One question's draft in the editor. Strings keep half-typed numbers intact. */
export interface FilterDraftEntry {
  values: string[];
  text: string;
  min: string;
  max: string;
  answered: boolean;
}
export type FilterDraft = Record<string, FilterDraftEntry>;

export const emptyEntry = (): FilterDraftEntry => ({
  values: [],
  text: '',
  min: '',
  max: '',
  answered: false,
});

export function toDraft(conditions: FilterCondition[] | undefined | null): FilterDraft {
  const draft: FilterDraft = {};
  for (const c of conditions ?? []) {
    const entry = (draft[c.key] ??= emptyEntry());
    if (c.op === 'any_of') entry.values = [...(c.values ?? [])];
    else if (c.op === 'contains') entry.text = c.text ?? '';
    else if (c.op === 'range') {
      entry.min = c.min_value != null ? String(c.min_value) : '';
      entry.max = c.max_value != null ? String(c.max_value) : '';
    } else if (c.op === 'answered') entry.answered = true;
  }
  return draft;
}

export function toConditions(draft: FilterDraft, questions: Question[]): FilterCondition[] {
  const out: FilterCondition[] = [];
  for (const q of questions) {
    const e = draft[q.key];
    if (!e) continue;
    if (e.answered) out.push({ key: q.key, op: 'answered' });
    if ((q.type === 'choice' || q.type === 'multichoice') && e.values.length)
      out.push({ key: q.key, op: 'any_of', values: [...e.values] });
    if (q.type === 'number') {
      const min = parseFloat(e.min);
      const max = parseFloat(e.max);
      if (!Number.isNaN(min) || !Number.isNaN(max)) {
        const cond: FilterCondition = { key: q.key, op: 'range' };
        if (!Number.isNaN(min)) cond.min_value = min;
        if (!Number.isNaN(max)) cond.max_value = max;
        out.push(cond);
      }
    }
    if (q.type === 'text' && e.text.trim())
      out.push({ key: q.key, op: 'contains', text: e.text.trim() });
  }
  return out;
}

/** A multi-choice answer is stored as a JSON list; show it as "a, b". */
export function registrantAnswer(raw: string | undefined, question?: Question): string {
  if (!raw) return '';
  if (question?.type !== 'multichoice') return raw;
  try {
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.join(', ') : raw;
  } catch {
    return raw;
  }
}

function matches(cond: FilterCondition, raw: string | undefined, question?: Question): boolean {
  if (!raw) return false;
  let value = String(raw);
  if (question?.type === 'multichoice') {
    let selected: string[] = [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) selected = parsed.map(String);
    } catch {
      /* A malformed stored answer counts as no answer. */
    }
    if (cond.op === 'answered') return selected.length > 0;
    if (cond.op === 'any_of') return selected.some((s) => (cond.values ?? []).includes(s));
    value = selected.join(', ');
    if (!value) return false;
  }
  if (cond.op === 'answered') return value.trim() !== '';
  if (cond.op === 'any_of') return (cond.values ?? []).includes(value);
  if (cond.op === 'contains') {
    const needle = (cond.text ?? '').trim().toLowerCase();
    return !!needle && value.toLowerCase().includes(needle);
  }
  if (cond.op === 'range') {
    const num = parseFloat(value.trim().replace(',', '.'));
    if (Number.isNaN(num)) return false;
    if (cond.min_value != null && num < cond.min_value) return false;
    if (cond.max_value != null && num > cond.max_value) return false;
    return true;
  }
  return false;
}

/** Registrants that pass every condition (everyone when there are none). */
export function eligibleOf(
  registrants: Registrant[],
  conditions: FilterCondition[],
  questions: Question[],
): Registrant[] {
  if (!conditions.length) return registrants;
  const byKey = new Map(questions.map((q) => [q.key, q]));
  return registrants.filter((r) =>
    conditions.every((c) => matches(c, r.answers?.[c.key], byKey.get(c.key))),
  );
}

/** Order-independent form of a condition list, to tell whether the editor holds unsaved changes. */
export const canonical = (conditions: FilterCondition[] | undefined | null) =>
  JSON.stringify(
    (conditions ?? []).map((c) => [
      c.key,
      c.op,
      [...(c.values ?? [])].sort(),
      c.text ?? '',
      c.min_value ?? null,
      c.max_value ?? null,
    ]),
  );
