#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

FENCE_RE = re.compile(r"```(?P<lang>[^\n`]*)\n(?P<code>.*?)```", re.DOTALL)
FILE_HINT_RE = re.compile(r"^\s*//\s*([A-Za-z0-9_.-]+\.(?:ts|tsx))\s*$")
HEADING_FILE_RE = re.compile(r"^\s*#+\s+`?([A-Za-z0-9_.-]+\.(?:ts|tsx))`?\s*$", re.MULTILINE)
DIAGNOSTIC_RE = re.compile(r"^(?P<file>.+?)\((?P<line>\d+),(?P<column>\d+)\): error TS(?P<code>\d+): (?P<message>.+)$")


def skill_dir_from_script(script_path: Path) -> Path:
    return script_path.resolve().parents[1]


def workspace_dir(skill_dir: Path) -> Path:
    return skill_dir.parent / f"{skill_dir.name}-workspace"


def harness_dir(skill_dir: Path) -> Path:
    return workspace_dir(skill_dir) / "ts-harness"


def read_local_versions() -> tuple[str, str]:
    xstate_pkg = Path("/Users/davidkpiano/Code/xstate/packages/core/package.json")
    react_pkg = Path("/Users/davidkpiano/Code/xstate/packages/xstate-react/package.json")
    if xstate_pkg.exists() and react_pkg.exists():
        return (
            json.loads(xstate_pkg.read_text())["version"],
            json.loads(react_pkg.read_text())["version"],
        )
    return ("5.30.0", "6.1.0")


def ensure_harness(base_dir: Path) -> None:
    base_dir.mkdir(parents=True, exist_ok=True)
    xstate_version, react_version = read_local_versions()
    package_json = {
        "name": "xstate-v5-eval-harness",
        "private": True,
        "type": "module",
        "dependencies": {
            "xstate": xstate_version,
            "@xstate/react": react_version,
            "react": "^19.0.0",
            "@types/react": "^19.0.0",
            "typescript": "^5.9.0",
        },
    }

    package_path = base_dir / "package.json"
    marker_path = base_dir / ".versions.json"
    desired_marker = {
        "xstate": xstate_version,
        "@xstate/react": react_version,
        "react": "^19.0.0",
        "@types/react": "^19.0.0",
        "typescript": "^5.9.0",
    }

    should_install = (
        not (base_dir / "node_modules").exists()
        or not package_path.exists()
        or not marker_path.exists()
    )

    if not should_install:
        try:
            should_install = json.loads(marker_path.read_text()) != desired_marker
        except json.JSONDecodeError:
            should_install = True

    if should_install:
        package_path.write_text(json.dumps(package_json, indent=2) + "\n")
        marker_path.write_text(json.dumps(desired_marker, indent=2) + "\n")
        subprocess.run(
            ["npm", "install", "--silent"],
            cwd=base_dir,
            check=True,
        )


def extract_blocks(markdown: str) -> list[tuple[str, str, str | None]]:
    blocks: list[tuple[str, str, str | None]] = []
    for match in FENCE_RE.finditer(markdown):
        lang = match.group("lang").strip().lower()
        code = match.group("code").strip()
        if not code:
            continue
        if not lang:
            continue
        if not lang.startswith(("ts", "js", "jsx")):
            continue
        heading_hint = None
        for heading_match in HEADING_FILE_RE.finditer(markdown[: match.start()]):
            heading_hint = heading_match.group(1)
        blocks.append((lang, code, heading_hint))
    return blocks


def guess_filename(code: str, lang: str, index: int, heading_hint: str | None) -> str:
    first_line = code.splitlines()[0] if code.splitlines() else ""
    hint_match = FILE_HINT_RE.match(first_line)
    if hint_match:
        return hint_match.group(1)
    if heading_hint:
        return heading_hint

    ext = "tsx" if lang in {"tsx", "jsx"} or re.search(r"return\s*<|<\w", code) else "ts"
    return f"snippet-{index}.{ext}"


def unique_name(name: str, used: set[str]) -> str:
    if name not in used:
        used.add(name)
        return name

    stem = Path(name).stem
    suffix = Path(name).suffix
    counter = 2
    while True:
        candidate = f"{stem}-{counter}{suffix}"
        if candidate not in used:
            used.add(candidate)
            return candidate
        counter += 1


def make_case_dir(base_dir: Path, requested_dir: Path | None) -> Path:
    if requested_dir is not None:
        requested_dir.mkdir(parents=True, exist_ok=True)
        return requested_dir

    cases_dir = base_dir / "cases"
    cases_dir.mkdir(parents=True, exist_ok=True)
    case_name = f"case-{int(time.time() * 1000)}"
    case_dir = cases_dir / case_name
    case_dir.mkdir()
    return case_dir


def write_case_files(case_dir: Path, blocks: list[tuple[str, str, str | None]]) -> list[str]:
    used: set[str] = set()
    files: list[str] = []
    for index, (lang, code, heading_hint) in enumerate(blocks, start=1):
        filename = unique_name(guess_filename(code, lang, index, heading_hint), used)
        (case_dir / filename).write_text(code + "\n")
        files.append(filename)
    return files


def write_tsconfig(case_dir: Path) -> None:
    tsconfig = {
        "compilerOptions": {
            "target": "ES2022",
            "module": "ESNext",
            "moduleResolution": "Bundler",
            "jsx": "react-jsx",
            "strict": True,
            "noEmit": True,
            "skipLibCheck": True,
            "lib": ["ES2022", "DOM"],
            "types": ["react"],
        },
        "include": ["**/*.ts", "**/*.tsx"],
    }
    (case_dir / "tsconfig.json").write_text(json.dumps(tsconfig, indent=2) + "\n")


def typecheck(case_dir: Path, base_dir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["npm", "exec", "--", "tsc", "-p", str(case_dir / "tsconfig.json"), "--pretty", "false"],
        cwd=base_dir,
        capture_output=True,
        text=True,
    )


def parse_diagnostics(output: str) -> dict[str, object]:
    diagnostics: list[dict[str, object]] = []
    categories = {
        "missing_module_errors": 0,
        "missing_name_errors": 0,
        "implicit_any_errors": 0,
        "assignability_errors": 0,
        "syntax_errors": 0,
        "other_errors": 0,
    }

    for line in output.splitlines():
        match = DIAGNOSTIC_RE.match(line.strip())
        if not match:
            continue

        code = int(match.group("code"))
        message = match.group("message")
        diagnostic = {
            "file": match.group("file"),
            "line": int(match.group("line")),
            "column": int(match.group("column")),
            "code": code,
            "message": message,
        }
        diagnostics.append(diagnostic)

        if code == 2307:
            categories["missing_module_errors"] += 1
        elif code == 2304:
            categories["missing_name_errors"] += 1
        elif code == 7006:
            categories["implicit_any_errors"] += 1
        elif code in {2322, 2345, 2741, 2326}:
            categories["assignability_errors"] += 1
        elif 1000 <= code < 2000:
            categories["syntax_errors"] += 1
        else:
            categories["other_errors"] += 1

    return {
        "diagnostics": diagnostics,
        "categories": categories,
        "has_cross_file_reference_errors": (
            categories["missing_module_errors"] > 0 or categories["missing_name_errors"] > 0
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("markdown_file", type=Path)
    parser.add_argument("--case-dir", type=Path)
    parser.add_argument("--keep-case-dir", action="store_true")
    args = parser.parse_args()

    script_path = Path(__file__)
    skill_dir = skill_dir_from_script(script_path)
    base_dir = harness_dir(skill_dir)
    ensure_harness(base_dir)

    markdown = args.markdown_file.read_text()
    blocks = extract_blocks(markdown)
    case_dir = make_case_dir(base_dir, args.case_dir)

    result: dict[str, object] = {
        "markdown_file": str(args.markdown_file),
        "case_dir": str(case_dir),
        "compile_success": False,
        "files": [],
        "stdout": "",
        "stderr": "",
        "returncode": None,
        "reason": "",
    }

    if not blocks:
        result["reason"] = "No TypeScript/TSX/JSX code fences found."
        print(json.dumps(result, indent=2))
        return 0

    files = write_case_files(case_dir, blocks)
    write_tsconfig(case_dir)
    proc = typecheck(case_dir, base_dir)

    result["files"] = files
    result["stdout"] = proc.stdout
    result["stderr"] = proc.stderr
    result["returncode"] = proc.returncode
    result["compile_success"] = proc.returncode == 0
    result["reason"] = "ok" if proc.returncode == 0 else "TypeScript compilation failed."
    result["diagnostics_summary"] = parse_diagnostics(proc.stdout)

    print(json.dumps(result, indent=2))

    if not args.keep_case_dir and args.case_dir is None and proc.returncode == 0:
        shutil.rmtree(case_dir, ignore_errors=True)

    return 0


if __name__ == "__main__":
    sys.exit(main())
