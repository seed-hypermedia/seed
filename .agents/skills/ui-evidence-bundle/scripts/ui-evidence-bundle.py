#!/usr/bin/env python3
"""Create and verify small, deterministic, source-bound UI evidence bundles."""
from __future__ import annotations
import argparse, hashlib, json, os, re, stat, tempfile, zipfile
from pathlib import Path, PurePosixPath

SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
URL_RE = re.compile(r"^(ipfs://[^\s]+|https://[^\s]+)$")
SURFACES = {"web-desktop", "web-mobile", "desktop-electron"}
VERDICTS = {"reproduced", "verified", "blocked", "failed"}
STATUSES = {"passed", "failed"}
MAX_FILES, MAX_FILE_SIZE, MAX_TOTAL_SIZE = 64, 64 * 1024 * 1024, 256 * 1024 * 1024
MAX_METADATA_SIZE = 1024 * 1024
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def fail(message: str):
    raise ValueError(message)


def canonical(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def safe_rel(path: str) -> str:
    if "\\" in path:
        fail("paths must use forward slashes")
    p = PurePosixPath(path)
    if p.is_absolute() or not p.parts or any(part in {"", ".", ".."} for part in p.parts):
        fail("path must be a safe relative path")
    return str(p)


def validate_manifest(m: dict) -> None:
    if m.get("schemaVersion") != 1 or m.get("kind") != "seed.ui-evidence": fail("unsupported schema")
    src = m.get("source", {})
    if not SHA_RE.fullmatch(src.get("sourceSha", "")): fail("sourceSha must be 40 lowercase hex")
    if not re.fullmatch(r"[1-9][0-9]{0,6}", str(src.get("issue", ""))): fail("issue must be numeric")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", src.get("repository", "")): fail("invalid repository")
    acc = m.get("acceptance", {})
    if acc.get("surface") not in SURFACES or acc.get("verdict") not in VERDICTS: fail("invalid acceptance")
    if not ID_RE.fullmatch(acc.get("scenario", "")): fail("invalid scenario")
    build = m.get("build")
    if build is not None:
        for key in ("workflowCommit", "sourceSha"):
            if not SHA_RE.fullmatch(build.get(key, "")): fail(f"invalid build {key}")
        if build["sourceSha"] != src["sourceSha"] or build.get("manifestVerified") is not True:
            fail("build provenance does not match verified source")
        if not re.fullmatch(r"[0-9a-f]{64}", build.get("sha256", "")): fail("invalid build sha256")
        if not URL_RE.fullmatch(build.get("runUrl", "")): fail("invalid build runUrl")
    files = m.get("files", [])
    if not isinstance(files, list) or len(files) > MAX_FILES: fail("invalid file count")
    ids, paths, total = set(), set(), 0
    for f in files:
        fid, path = f.get("id", ""), safe_rel(f.get("path", ""))
        if not ID_RE.fullmatch(fid) or fid in ids: fail("invalid or duplicate file id")
        if path in paths or not path.startswith("evidence/"): fail("invalid or duplicate evidence path")
        if not isinstance(f.get("size"), int) or not 0 <= f["size"] <= MAX_FILE_SIZE: fail("invalid file size")
        if not re.fullmatch(r"[0-9a-f]{64}", f.get("sha256", "")): fail("invalid file sha256")
        if "publicUrl" in f and not URL_RE.fullmatch(f["publicUrl"]): fail("invalid publicUrl")
        ids.add(fid); paths.add(path); total += f["size"]
    if total > MAX_TOTAL_SIZE: fail("bundle exceeds total size limit")
    check_ids = set()
    for check in m.get("checks", []):
        cid = check.get("id", "")
        if not ID_RE.fullmatch(cid) or cid in check_ids or check.get("status") not in STATUSES: fail("invalid check")
        refs = check.get("evidence", [])
        if not isinstance(refs, list) or any(ref not in ids for ref in refs): fail("dangling evidence reference")
        check_ids.add(cid)


def summary(m: dict) -> str:
    src, acc = m["source"], m["acceptance"]
    lines = ["# UI acceptance evidence", "", f"- Repository: `{src['repository']}`", f"- Issue: #{src['issue']}",
             f"- Exact source: `{src['sourceSha']}`", f"- Surface: `{acc['surface']}`", f"- Scenario: `{acc['scenario']}`",
             f"- Verdict: **{acc['verdict'].upper()}**"]
    if m.get("build"): lines += [f"- Package run: {m['build']['runUrl']}", f"- Package SHA-256: `{m['build']['sha256']}`"]
    lines += ["", "## Checks"] + [f"- [{'x' if c['status']=='passed' else ' '}] `{c['id']}` — {c.get('description','')}" for c in m["checks"]]
    links = [f"- `{f['id']}`: {f['publicUrl']}" for f in m["files"] if f.get("publicUrl")]
    if links: lines += ["", "## Durable evidence links", *links]
    return "\n".join(lines) + "\n"


def zip_write(z: zipfile.ZipFile, name: str, data: bytes) -> None:
    info = zipfile.ZipInfo(name, FIXED_TIME); info.create_system = 3; info.compress_type = zipfile.ZIP_STORED; info.external_attr = 0o100644 << 16
    z.writestr(info, data)


def create(spec_path: Path, output: Path) -> dict:
    spec = json.loads(spec_path.read_text())
    base = spec_path.parent.resolve(); manifest = {k: spec[k] for k in ("schemaVersion", "kind", "source", "acceptance", "checks")}
    if "build" in spec: manifest["build"] = spec["build"]
    manifest["files"] = [] ; payloads = []
    inputs = spec.get("files", [])
    if not isinstance(inputs, list) or len(inputs) > MAX_FILES: fail("invalid file count")
    total = 0
    for f in inputs:
        rel = safe_rel(f["sourcePath"]); lexical = base / rel
        if lexical.is_symlink(): fail("evidence source must not be a symlink")
        src = lexical.resolve()
        try: src.relative_to(base)
        except ValueError: fail("sourcePath escapes spec directory")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(src, flags)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_size > MAX_FILE_SIZE: fail("invalid evidence source")
            data = b""
            while len(data) <= MAX_FILE_SIZE:
                chunk = os.read(fd, min(1024 * 1024, MAX_FILE_SIZE + 1 - len(data)))
                if not chunk: break
                data += chunk
            if len(data) > MAX_FILE_SIZE: fail("invalid evidence source")
        finally: os.close(fd)
        total += len(data)
        if total > MAX_TOTAL_SIZE: fail("bundle exceeds total size limit")
        if not f.get("mediaType"): fail("mediaType is required for deterministic output")
        entry = {"id": f["id"], "path": "evidence/" + safe_rel(f.get("bundlePath", src.name)), "size": len(data),
                 "sha256": hashlib.sha256(data).hexdigest(), "mediaType": f["mediaType"]}
        if f.get("publicUrl"): entry["publicUrl"] = f["publicUrl"]
        manifest["files"].append(entry); payloads.append((entry["path"], data))
    manifest["files"].sort(key=lambda f: f["path"]); validate_manifest(manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=output.name + ".", suffix=".tmp", dir=output.parent); os.close(fd); tmp = Path(temp_name)
    try:
        with zipfile.ZipFile(tmp, "w") as z:
            zip_write(z, "manifest.json", canonical(manifest)); zip_write(z, "summary.md", summary(manifest).encode())
            for name, data in sorted(payloads): zip_write(z, name, data)
        verify(tmp, manifest["source"]["sourceSha"]); os.replace(tmp, output)
    finally:
        tmp.unlink(missing_ok=True)
    return {"bundle": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "manifest": manifest}


def verify(bundle: Path, expected_source_sha: str | None = None) -> dict:
    if bundle.stat().st_size > MAX_TOTAL_SIZE: fail("archive exceeds size limit")
    with zipfile.ZipFile(bundle) as z:
        infos = z.infolist(); names = [i.filename for i in infos]
        if len(infos) > MAX_FILES + 2 or len(names) != len(set(names)): fail("invalid archive member count")
        if any(i.is_dir() or safe_rel(i.filename) != i.filename for i in infos): fail("unsafe archive member")
        if any(i.file_size > MAX_FILE_SIZE for i in infos) or sum(i.file_size for i in infos) > MAX_TOTAL_SIZE + 2 * MAX_METADATA_SIZE: fail("archive expansion exceeds limit")
        by_name = {i.filename: i for i in infos}
        if "manifest.json" not in by_name or by_name["manifest.json"].file_size > MAX_METADATA_SIZE: fail("invalid manifest")
        manifest = json.loads(z.read("manifest.json")); validate_manifest(manifest)
        if expected_source_sha is not None and manifest["source"]["sourceSha"] != expected_source_sha: fail("bundle source does not match expected source")
        expected = {"manifest.json", "summary.md", *(f["path"] for f in manifest["files"])}
        if set(names) != expected: fail("archive members do not match manifest")
        if z.read("manifest.json") != canonical(manifest) or z.read("summary.md") != summary(manifest).encode(): fail("derived files are not canonical")
        total = 0
        for f in manifest["files"]:
            data = z.read(f["path"]); total += len(data)
            if len(data) != f["size"] or hashlib.sha256(data).hexdigest() != f["sha256"]: fail("evidence hash mismatch")
        if total > MAX_TOTAL_SIZE: fail("expanded archive exceeds size limit")
    return {"bundle": str(bundle), "sha256": hashlib.sha256(bundle.read_bytes()).hexdigest(), "manifest": manifest}


def main() -> None:
    p = argparse.ArgumentParser(); sub = p.add_subparsers(dest="command", required=True)
    c = sub.add_parser("create"); c.add_argument("spec", type=Path); c.add_argument("output", type=Path)
    v = sub.add_parser("verify"); v.add_argument("bundle", type=Path); v.add_argument("--expected-source-sha")
    a = p.parse_args(); result = create(a.spec, a.output) if a.command == "create" else verify(a.bundle, a.expected_source_sha)
    print(json.dumps(result, sort_keys=True))
if __name__ == "__main__": main()
