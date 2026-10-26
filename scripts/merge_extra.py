#!/usr/bin/env python3
"""Merge the extra multiple-choice questions into the compass data.

Input:  data/education_compass_2026.json  (sourced base compass, 25 questions)
        data/extra_questions_2026.json    (30 questions with party alignments, no sources)
Output: data/compass.json                 (what the app loads)

Fails loudly on any alignment name that is not mapped below, so a typo or a new
party never silently disappears from the scoring.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "data" / "education_compass_2026.json"
EXTRA = ROOT / "data" / "extra_questions_2026.json"
OUT = ROOT / "data" / "compass.json"

LETTERS = ["A", "B", "C", "D"]

# alignment name -> list of (party_id, component). A component is a constituent
# of a joint list; when two components of one list pick different options, the
# question is not scored for that list.
ALIASES = {
    "ישראל ביתנו": [("beytenu", None)],
    "יש עתיד": [("beyahad", "יש עתיד")],
    "ש״ס": [("shas", None)],
    "יהדות התורה": [("utj", None)],
    "הליכוד": [("likud", None)],
    "הדמוקרטים": [("democrats", None)],
    "עמך": [("amcha", None)],
    "הציונות הדתית": [("religious_zionism_zehut", "הציונות הדתית")],
    "עוצמה יהודית": [("otzma", None)],
    "הכלכלה החדשה (זליכה)": [("reservists_economic", "הכלכלה החדשה (זליכה)")],
    "יועז הנדל": [("reservists_economic", "יועז הנדל")],
    "מפלגות ערביות": [("joint_list", None), ("raam", None)],
    "מפלגות ערביות (רע״מ, חד״ש-תע״ל)": [("joint_list", None), ("raam", None)],
}
# Names deliberately left out of the scoring (no matching list on the ballot).
UNSCORED = {"המחנה הממלכתי", "חרדים מודרניים"}

# Lists made of several components that appear in the extra questions
# under separate names. Silence from one component is not agreement.
MULTI_COMPONENT = {"reservists_economic": {"יועז הנדל", "הכלכלה החדשה (זליכה)"}}

# Topic families: each gets an icon and a color in the app.
THEMES = {
    "core": "ליבה וזרמים",
    "gov": "משילות ותקציב",
    "teachers": "מורים",
    "early": "גיל רך",
    "identity": "זהות וערכים",
    "equity": "שוויון ופערים",
    "learning": "למידה והערכה",
    "safety": "אקלים, נוער ושירות",
    "higher": "השכלה גבוהה",
}
CORE_THEMES = {
    "Q01": "core", "Q02": "core", "Q03": "gov", "Q04": "gov", "Q05": "teachers", "Q06": "teachers",
    "Q07": "equity", "Q08": "equity", "Q09": "early", "Q10": "early", "Q11": "identity", "Q12": "identity",
    "Q13": "identity", "Q14": "learning", "Q15": "learning", "Q16": "gov", "Q17": "teachers", "Q18": "early",
    "Q19": "identity", "Q20": "core", "Q21": "gov", "Q22": "learning", "Q23": "equity", "Q24": "safety",
    "Q25": "higher",
}
# keyed by the id in extra_questions_2026.json
EXTRA_THEMES = {
    1: "core", 2: "teachers", 3: "early", 4: "identity", 5: "equity", 6: "teachers", 7: "identity",
    8: "gov", 9: "learning", 10: "equity", 11: "gov", 12: "identity", 13: "equity", 14: "safety",
    15: "higher", 16: "teachers", 17: "safety", 18: "identity", 19: "safety", 20: "teachers",
    21: "learning", 22: "gov", 23: "core", 24: "equity", 25: "learning", 26: "learning", 27: "higher",
    28: "equity", 29: "identity", 30: "safety",
}


def norm(name):
    return name.replace('"', "״").strip()


def fail(msg):
    sys.exit(f"merge_extra: {msg}")


def main():
    base = json.loads(BASE.read_text(encoding="utf-8"))
    extra = json.loads(EXTRA.read_text(encoding="utf-8"))
    parties = {p["id"]: p["name"] for p in base["parties"]}
    aliases = {norm(k): v for k, v in ALIASES.items()}
    unscored = {norm(n) for n in UNSCORED}

    for pid_list in aliases.values():
        for pid, _ in pid_list:
            if pid not in parties:
                fail(f"alias points to unknown party id {pid}")

    questions = [dict(q, section="core", theme=CORE_THEMES.get(q["id"])) for q in base["questions"]]
    matrix = list(base["position_matrix"])
    conflicts = list(base.get("unscored_conflicts", []))
    next_num = len(questions) + 1
    seen_origin = set()

    for item in extra:
        if item["id"] in seen_origin:
            fail(f"duplicate extra question id {item['id']}")
        seen_origin.add(item["id"])
        if len(item["options"]) != 4:
            fail(f"extra question {item['id']} must have 4 options")
        qid = f"Q{next_num:02d}"
        next_num += 1
        questions.append({
            "id": qid,
            "type": "multiple_choice",
            "topic": item["topic"],
            "text": item["question"],
            "weight": 1,
            "options": {LETTERS[i]: o["answer"] for i, o in enumerate(item["options"])},
            "section": "extra",
            "origin_id": item["id"],
            "theme": EXTRA_THEMES.get(item["id"]),
        })

        # party_id -> component -> set of letters
        picks = {}
        via = {}
        for i, opt in enumerate(item["options"]):
            for raw in opt["alignment"]:
                name = norm(raw)
                if name in unscored:
                    continue
                if name not in aliases:
                    fail(f"extra question {item['id']}: unmapped alignment name {raw!r}")
                for pid, comp in aliases[name]:
                    picks.setdefault(pid, {}).setdefault(comp or "_self", set()).add(LETTERS[i])
                    if name != norm(parties[pid]):
                        via.setdefault(pid, set()).add(name)

        for pid, pname in parties.items():
            row = {
                "question_id": qid, "party_id": pid, "party": pname, "type": "multiple_choice",
                "position": None, "status": "unknown", "source_id": None, "source_url": None,
                "evidence_grade": None, "explanation": "",
            }
            comps = picks.get(pid)
            if comps:
                sets = list(comps.values())
                common = set.intersection(*sets)
                notes = []
                if pid in MULTI_COMPONENT and len(comps) == 1:
                    notes.append(f"לפי מרכיב אחד בלבד: {next(iter(comps))}")
                elif via.get(pid):
                    notes.append(f"לפי {', '.join(sorted(via[pid]))}")
                if not common:
                    row["status"] = "conflicting_components"
                    detail = "; ".join(f"{c}: {' / '.join(sorted(s))}" for c, s in comps.items())
                    row["explanation"] = f"מרכיבי הרשימה שויכו לאפשרויות שונות ({detail}); לא נוקד"
                    conflicts.append({
                        "question_id": qid, "party_id": pid, "party": pname,
                        "status": "conflicting_components", "note": row["explanation"], "sources": [],
                    })
                else:
                    row["status"] = "estimated"
                    row["position"] = sorted(common)
                    row["evidence_grade"] = "U"
                    row["explanation"] = "; ".join(notes)
            matrix.append(row)

    # Integrity checks over the merged data.
    qmap = {q["id"]: q for q in questions}
    if len(qmap) != len(questions):
        fail("duplicate question ids")
    keys = set()
    for r in matrix:
        k = (r["question_id"], r["party_id"])
        if k in keys:
            fail(f"duplicate position row {k}")
        keys.add(k)
        q = qmap.get(r["question_id"])
        if q is None or r["party_id"] not in parties:
            fail(f"row points to unknown question or party {k}")
        if r["status"] in ("documented", "estimated"):
            pos = r["position"] if isinstance(r["position"], list) else [r["position"]]
            if q["type"] == "likert":
                if any(p not in ("support", "oppose", "qualified") for p in pos):
                    fail(f"bad likert position {k}: {r['position']}")
            elif not pos or any(p not in q["options"] for p in pos):
                fail(f"bad option position {k}: {r['position']}")
    for q in questions:
        if q.get("theme") not in THEMES:
            fail(f"question {q['id']} has no valid theme")
        for pid in parties:
            if (q["id"], pid) not in keys:
                fail(f"missing row for {q['id']} / {pid}")

    out = dict(base)
    out["questions"] = questions
    out["position_matrix"] = matrix
    out["unscored_conflicts"] = conflicts
    meta = dict(base["meta"])
    meta["counts"] = {
        "questions": len(questions),
        "likert": sum(q["type"] == "likert" for q in questions),
        "multiple_choice": sum(q["type"] == "multiple_choice" for q in questions),
        "parties": len(parties),
        "documented_party_question_positions": sum(r["status"] == "documented" for r in matrix),
        "estimated_party_question_positions": sum(r["status"] == "estimated" for r in matrix),
    }
    meta["sections"] = {
        "core": "שאלות עם עמדות מתועדות ומקורות",
        "extra": "שאלות נוספות; השיוך למפלגות הוא הערכה ללא קישור למקור",
    }
    meta["themes"] = THEMES
    meta["extra_mapping"] = {
        "aliases": {k: [p for p, _ in v] for k, v in ALIASES.items()},
        "unscored": sorted(UNSCORED),
    }
    out["meta"] = meta
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    c = meta["counts"]
    print(f"wrote {OUT.relative_to(ROOT)}: {c['questions']} questions, "
          f"{c['documented_party_question_positions']} documented, "
          f"{c['estimated_party_question_positions']} estimated, "
          f"{len(conflicts)} unscored conflicts")


if __name__ == "__main__":
    main()
