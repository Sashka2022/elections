// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../scoring.js");

const L = id => ({ id, type: "likert", weight: 1, options: null });
const M = id => ({ id, type: "multiple_choice", weight: 1, options: { A: "a", B: "b", C: "c", D: "d" } });
const row = (q, p, position, status = "documented") => ({ question_id: q, party_id: p, position, status });
const P = [{ id: "p1", name: "אלף" }, { id: "p2", name: "בית" }];
const run = (questions, matrix, answers, extra = {}) =>
  S.scoreParties({ questions, parties: P, matrix, answers, minCompared: 1, confidence: 0, ...extra });
const byId = (res, id) => res.find(r => r.party.id === id);

test("likert distance maps support=5, oppose=1, qualified=4", () => {
  const qs = [L("Q1")];
  const m = [row("Q1", "p1", "support"), row("Q1", "p2", "qualified")];
  assert.equal(byId(run(qs, m, { Q1: 5 }), "p1").pct, 1);
  assert.equal(byId(run(qs, m, { Q1: 1 }), "p1").pct, 0);
  assert.equal(byId(run(qs, m, { Q1: 3 }), "p1").pct, 0.5);
  assert.equal(byId(run(qs, m, { Q1: 4 }), "p2").pct, 1);
});

test("unknown and conflicting rows are never counted", () => {
  const qs = [M("Q1"), M("Q2")];
  const m = [row("Q1", "p1", "A"), row("Q2", "p1", null, "unknown"), row("Q2", "p2", null, "conflicting_components")];
  const r = run(qs, m, { Q1: "A", Q2: "B" });
  assert.equal(byId(r, "p1").compared, 1);
  assert.equal(byId(r, "p1").pct, 1);
  assert.equal(byId(r, "p2").pct, null);
});

test("skips and stale or invalid answers are ignored", () => {
  const qs = [L("Q1"), M("Q2"), M("Q3")];
  const m = [row("Q1", "p1", "support"), row("Q2", "p1", "A"), row("Q3", "p1", "A")];
  const r = byId(run(qs, m, { Q1: "skip", Q2: "Z", Q3: "A", Q9: "A" }), "p1");
  assert.equal(r.of, 1);
  assert.equal(r.compared, 1);
  assert.equal(r.pct, 1);
  assert.equal(byId(run(qs, m, { Q1: 7 }), "p1").compared, 0);
  assert.equal(byId(run(qs, m, { Q1: "5" }), "p1").compared, 0);
});

test("important doubles the weight", () => {
  const qs = [M("Q1"), M("Q2")];
  const m = [row("Q1", "p1", "A"), row("Q2", "p1", "A")];
  const a = { Q1: "A", Q2: "B" };
  assert.equal(byId(run(qs, m, a), "p1").pct, 0.5);
  assert.ok(Math.abs(byId(run(qs, m, a, { important: { Q1: true } }), "p1").pct - 2 / 3) < 1e-12);
});

test("multiple-choice row with several options matches any of them", () => {
  const qs = [M("Q1")];
  const m = [row("Q1", "p1", ["A", "D"], "estimated")];
  assert.equal(byId(run(qs, m, { Q1: "D" }), "p1").pct, 1);
  assert.equal(byId(run(qs, m, { Q1: "B" }), "p1").pct, 0);
});

test("estimated rows can be switched off", () => {
  const qs = [M("Q1"), M("Q2")];
  const m = [row("Q1", "p1", "A"), row("Q2", "p1", ["B"], "estimated")];
  const a = { Q1: "A", Q2: "C" };
  const on = byId(run(qs, m, a), "p1");
  const off = byId(run(qs, m, a, { includeEstimated: false }), "p1");
  assert.equal(on.compared, 2);
  assert.equal(on.estimated, 1);
  assert.equal(on.pct, 0.5);
  assert.equal(off.compared, 1);
  assert.equal(off.pct, 1);
});

test("equal percents share a rank; parties with nothing compared go last unranked", () => {
  const parties = [{ id: "a", name: "א" }, { id: "b", name: "ב" }, { id: "c", name: "ג" }, { id: "d", name: "ד" }];
  const qs = [M("Q1"), M("Q2")];
  const m = [row("Q1", "a", "A"), row("Q2", "a", "A"), row("Q1", "b", "A"), row("Q2", "b", "A"), row("Q1", "c", "B")];
  const r = S.scoreParties({ questions: qs, parties, matrix: m, answers: { Q1: "A", Q2: "A" }, minCompared: 2 });
  assert.deepEqual(r.map(x => x.party.id), ["a", "b", "c", "d"]);
  assert.deepEqual(r.map(x => x.rank), [1, 1, 3, null]);
  assert.equal(r[2].thin, true);
  assert.equal(r[3].pct, null);
});

test("confidence: a party matched on many questions outranks a perfect match on one", () => {
  const parties = [{ id: "few", name: "א" }, { id: "many", name: "ב" }];
  const qs = Array.from({ length: 10 }, (_, i) => M("Q" + i));
  const answers = Object.fromEntries(qs.map(q => [q.id, "A"]));
  const m = [row("Q0", "few", "A")];
  qs.forEach((q, i) => m.push(row(q.id, "many", i < 9 ? "A" : "B")));
  const r = S.scoreParties({ questions: qs, parties, matrix: m, answers });
  const few = r.find(x => x.party.id === "few"), many = r.find(x => x.party.id === "many");
  assert.equal(few.raw, 1);
  assert.equal(many.raw, 0.9);
  assert.equal(r[0].party.id, "many");
  assert.ok(Math.abs(few.pct - S.wilsonLower(1, 1, 1.28)) < 1e-12);
});

test("confidence: zero gives the raw match; otherwise score <= raw and rises with coverage", () => {
  assert.equal(S.wilsonLower(0.7, 4, 0), 0.7);
  assert.equal(S.wilsonLower(0.7, 0, 1.28), null);
  let prev = -1;
  for (const n of [1, 2, 5, 10, 30, 100]) {
    const v = S.wilsonLower(0.7, n, 1.28);
    assert.ok(v <= 0.7 && v >= 0, `n=${n}`);
    assert.ok(v > prev, `n=${n} should rise`);
    prev = v;
  }
  assert.equal(S.wilsonLower(0, 5, 1.28), 0);
  assert.ok(S.wilsonLower(1, 5, 1.28) < 1);
  const qs = [M("Q1"), M("Q2"), M("Q3")];
  const m = [row("Q1", "p1", "A"), row("Q2", "p1", "B"), row("Q3", "p1", "A"), row("Q1", "p2", "B")];
  const a = { Q1: "A", Q2: "A", Q3: "A" };
  for (const r of S.scoreParties({ questions: qs, parties: P, matrix: m, answers: a, confidence: 0 })) assert.equal(r.pct, r.raw);
});

test("duplicate matrix rows do not double count", () => {
  const qs = [M("Q1")];
  const m = [row("Q1", "p1", "A"), row("Q1", "p1", "A")];
  assert.equal(byId(run(qs, m, { Q1: "A" }), "p1").compared, 1);
});

test("real merged data: every scored row is usable and percents stay in range", () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "compass.json"), "utf8"));
  const qmap = Object.fromEntries(d.questions.map(q => [q.id, q]));
  for (const r of d.position_matrix) {
    if (r.status === "documented" || r.status === "estimated") {
      assert.ok(S.rowPositions(qmap[r.question_id], r, true), `${r.question_id}/${r.party_id}`);
    }
  }
  // Answer every question every possible way in a fixed rotation and check invariants.
  for (let shift = 0; shift < 5; shift++) {
    const answers = {};
    d.questions.forEach((q, i) => {
      answers[q.id] = q.type === "likert" ? ((i + shift) % 5) + 1 : "ABCD"[(i + shift) % 4];
    });
    const res = S.scoreParties({ questions: d.questions, parties: d.parties, matrix: d.position_matrix, answers });
    assert.equal(res.length, d.parties.length);
    for (const r of res) {
      assert.ok(r.pct === null || (r.pct >= 0 && r.pct <= 1));
      assert.ok(r.raw === null || (r.raw >= 0 && r.raw <= 1));
      assert.equal(r.of, d.questions.length);
    }
    const off = S.scoreParties({ questions: d.questions, parties: d.parties, matrix: d.position_matrix, answers, includeEstimated: false });
    for (const r of off) assert.equal(r.estimated, 0);
  }
});

test("merged data: overlapping questions were reduced to one per cluster", () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "compass.json"), "utf8"));
  const ids = d.questions.map(q => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of d.meta.dropped_overlaps) {
    assert.ok(ids.includes(c.kept), c.kept);
    for (const q of c.dropped) assert.ok(!ids.includes(q), q);
  }
  assert.ok(d.position_matrix.every(r => ids.includes(r.question_id)));
  assert.equal(d.position_matrix.length, ids.length * d.parties.length);
});
