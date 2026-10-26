// Compass scoring, shared by the page (window.CompassScoring) and the tests (require).
(function (root) {
  "use strict";

  const LIKERT_PARTY = { support: 5, oppose: 1, qualified: 4 };
  const SCORED_STATUS = { documented: true, estimated: true };

  function isValidAnswer(q, a) {
    if (q.type === "likert") return Number.isInteger(a) && a >= 1 && a <= 5;
    return typeof a === "string" && !!q.options && Object.prototype.hasOwnProperty.call(q.options, a);
  }

  // The positions a party row can be matched against, or null if the row is not usable.
  function rowPositions(q, row, includeEstimated) {
    if (!row || !SCORED_STATUS[row.status] || row.position == null) return null;
    if (row.status === "estimated" && !includeEstimated) return null;
    const list = (Array.isArray(row.position) ? row.position : [row.position]).filter(p =>
      q.type === "likert" ? Object.prototype.hasOwnProperty.call(LIKERT_PARTY, p) : isValidAnswer(q, p));
    return list.length ? list : null;
  }

  function questionScore(q, a, positions) {
    if (q.type === "likert") {
      // A likert row always has one position; take the closest if data ever lists more.
      return Math.max(...positions.map(p => 1 - Math.abs(a - LIKERT_PARTY[p]) / 4));
    }
    return positions.includes(a) ? 1 : 0;
  }

  // Lower bound of the Wilson score interval for a match rate p over n question-weights.
  function wilsonLower(p, n, z) {
    if (!(n > 0)) return null;
    if (!(z > 0)) return p;
    const z2 = z * z;
    const centre = p + z2 / (2 * n);
    const margin = z * Math.sqrt(Math.max(0, p * (1 - p)) / n + z2 / (4 * n * n));
    return Math.min(p, Math.max(0, (centre - margin) / (1 + z2 / n)));
  }

  /**
   * opts: { questions, parties, matrix, answers, important, includeEstimated, minCompared, confidence }
   * Returns parties sorted for display.
   *   raw   - plain weighted match over the questions the party could be compared on
   *   pct   - weighted score used for ranking: the Wilson lower bound of the match, with the
   *           compared question-weight as the sample size. It equals raw when confidence is 0,
   *           never exceeds raw, and grows with the number of compared questions, so parties
   *           whose platform covers more of the user's answers get more weight and a party
   *           compared on a lucky handful cannot top the list.
   *   confidence - z value of the bound (default 1.28, a one-sided 90% bound).
   *   thin  - compared on fewer than minCompared questions (flag only, does not reorder)
   * pct and raw are null when nothing could be compared.
   */
  function scoreParties(opts) {
    const { questions, parties, matrix } = opts;
    const answers = opts.answers || {};
    const important = opts.important || {};
    const includeEstimated = opts.includeEstimated !== false;
    const minCompared = opts.minCompared == null ? 5 : opts.minCompared;
    const confidence = opts.confidence == null ? 1.28 : Math.max(0, Number(opts.confidence) || 0);

    const rows = new Map();
    for (const r of matrix) {
      const k = r.question_id + "|" + r.party_id;
      if (!rows.has(k)) rows.set(k, r);
    }
    const answered = questions.filter(q => isValidAnswer(q, answers[q.id]));

    const results = parties.map(p => {
      let sum = 0, weight = 0, estimated = 0;
      const items = [];
      for (const q of answered) {
        const row = rows.get(q.id + "|" + p.id);
        const positions = rowPositions(q, row, includeEstimated);
        if (!positions) continue;
        const a = answers[q.id];
        const base = Number(q.weight) > 0 ? Number(q.weight) : 1;
        const w = base * (important[q.id] ? 2 : 1);
        const s = questionScore(q, a, positions);
        sum += s * w;
        weight += w;
        if (row.status === "estimated") estimated++;
        items.push({ q, row, a, s, w, positions });
      }
      return { party: p, sum, weight, raw: weight > 0 ? sum / weight : null, pct: null,
               compared: items.length, of: answered.length, estimated, items,
               thin: items.length < minCompared };
    });

    for (const r of results) {
      if (r.weight > 0) r.pct = wilsonLower(r.raw, r.weight, confidence);
    }

    // Rounded percent decides order and shared ranks, so equal displayed numbers rank equally.
    const shown = r => (r.pct == null ? -1 : Math.round(r.pct * 100));
    results.sort((x, y) =>
      ((x.pct == null) - (y.pct == null)) ||
      (shown(y) - shown(x)) ||
      (y.compared - x.compared) ||
      x.party.name.localeCompare(y.party.name, "he"));

    let prev = null, rank = 0;
    results.forEach((r, i) => {
      if (r.pct == null) { r.rank = null; return; }
      if (prev === null || shown(r) !== prev) rank = i + 1;
      prev = shown(r);
      r.rank = rank;
    });
    return results;
  }

  const api = { LIKERT_PARTY, isValidAnswer, rowPositions, questionScore, wilsonLower, scoreParties };
  root.CompassScoring = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
