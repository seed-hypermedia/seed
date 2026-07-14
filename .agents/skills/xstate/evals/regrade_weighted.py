#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


def expectation_weight(text: str) -> float:
    if "compiles under the eval typecheck harness" in text:
        return 2.0
    if "imports, exports, and component references are wired coherently" in text:
        return 1.5
    return 1.0


def expectation_credit(expectation: dict, grading: dict) -> float:
    text = expectation["text"]
    if expectation.get("passed"):
        return 1.0

    if "imports, exports, and component references are wired coherently" in text:
        categories = (
            grading.get("typecheck", {})
            .get("diagnostics_summary", {})
            .get("categories", {})
        )
        cross_file_errors = categories.get("missing_module_errors", 0) + categories.get(
            "missing_name_errors", 0
        )
        # 1 error still gets most credit; 5+ gets none.
        return max(0.0, 1.0 - (cross_file_errors / 5.0))

    return 0.0


def regrade_file(path: Path) -> None:
    grading = json.loads(path.read_text())
    expectations = grading.get("expectations", [])
    if not expectations:
        return

    weighted_points = 0.0
    weighted_total = 0.0
    breakdown = []

    for expectation in expectations:
        weight = expectation_weight(expectation["text"])
        credit = expectation_credit(expectation, grading)
        weighted_points += weight * credit
        weighted_total += weight
        breakdown.append(
            {
                "text": expectation["text"],
                "weight": weight,
                "credit": round(credit, 4),
                "points": round(weight * credit, 4),
            }
        )

    raw_passed = sum(1 for expectation in expectations if expectation.get("passed"))
    raw_total = len(expectations)
    grading["summary"]["raw_pass_rate"] = round(raw_passed / raw_total, 4) if raw_total else 0.0
    grading["summary"]["pass_rate"] = round(weighted_points / weighted_total, 4) if weighted_total else 0.0
    grading["summary"]["weighted_points"] = round(weighted_points, 4)
    grading["summary"]["weighted_total"] = round(weighted_total, 4)
    grading["weighted_breakdown"] = breakdown
    path.write_text(json.dumps(grading, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("iteration_dir", type=Path)
    args = parser.parse_args()

    for grading_path in sorted(args.iteration_dir.glob("eval-*/**/grading.json")):
        regrade_file(grading_path)

    print(f"weighted regrade complete: {args.iteration_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
