/**
 * Word-level differences between two pages' text (for Compare). Words come
 * from Intl.Segmenter, so Thai and Chinese - written without spaces - are
 * split into real words too. The diff is a longest-common-subsequence over
 * the words; very long pages fall back to comparing line by line.
 */
export interface Word {
  text: string;
  /** Character range in the page text. */
  start: number;
  end: number;
}

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;

export function words(text: string): Word[] {
  const out: Word[] = [];
  if (segmenter) {
    for (const s of segmenter.segment(text)) {
      if (!s.segment.trim()) continue;
      // Punctuation counts too (a changed "," or "-" matters in a quote), but not separators.
      out.push({ text: s.segment, start: s.index, end: s.index + s.segment.length });
    }
    return out;
  }
  for (const m of text.matchAll(/\S+/g)) out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** Words only in `a` (removed) and only in `b` (added). */
export function diffWords(a: readonly Word[], b: readonly Word[], maxCells = 4_000_000): { removed: Word[]; added: Word[] } {
  // Trim the common start and end: most pages differ in a few places only.
  let s = 0;
  while (s < a.length && s < b.length && a[s].text === b[s].text) s++;
  let ea = a.length,
    eb = b.length;
  while (ea > s && eb > s && a[ea - 1].text === b[eb - 1].text) {
    ea--;
    eb--;
  }
  const A = a.slice(s, ea),
    B = b.slice(s, eb);
  if (!A.length || !B.length) return { removed: A, added: B };
  if (A.length * B.length > maxCells) return diffByLines(A, B);
  const n = A.length,
    m = B.length;
  // LCS lengths, bottom-up (Uint32: no overflow for any page).
  const L = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[at(i, j)] = A[i].text === B[j].text ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)]);
    }
  }
  const removed: Word[] = [],
    added: Word[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (A[i].text === B[j].text) {
      i++;
      j++;
    } else if (L[at(i + 1, j)] >= L[at(i, j + 1)]) removed.push(A[i++]);
    else added.push(B[j++]);
  }
  while (i < n) removed.push(A[i++]);
  while (j < m) added.push(B[j++]);
  return { removed, added };
}

/** Coarse fallback for huge pages: a word is changed if its whole sequence-of-words "line" is. */
function diffByLines(A: readonly Word[], B: readonly Word[]): { removed: Word[]; added: Word[] } {
  const key = (w: readonly Word[]) => w.map((x) => x.text).join(" ");
  const chunk = (w: readonly Word[]) => {
    const out: Word[][] = [];
    for (let i = 0; i < w.length; i += 12) out.push(w.slice(i, i + 12));
    return out;
  };
  const ca = chunk(A),
    cb = chunk(B);
  const inB = new Set(cb.map(key)),
    inA = new Set(ca.map(key));
  return {
    removed: ca.filter((c) => !inB.has(key(c))).flat(),
    added: cb.filter((c) => !inA.has(key(c))).flat(),
  };
}
