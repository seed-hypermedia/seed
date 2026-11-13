#!/usr/bin/env python3
"""Launch and verify credential-safe exact-source Linux desktop artifacts."""
from __future__ import annotations
import argparse, base64, hashlib, io, json, os, re, tempfile, time, urllib.error, urllib.parse, urllib.request, zipfile
from pathlib import Path

REPO = "ion-lion/seed"
BRANCH = "ion/exact-desktop-artifact"
WORKFLOW = ".github/workflows/ion-exact-desktop-artifact.yml"
API = f"https://api.github.com/repos/{REPO}"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
ISSUE_RE = re.compile(r"^[0-9]{1,7}$")
MAX_ARTIFACT_SIZE = 2 * 1024 * 1024 * 1024


def validate(source_sha: str, issue: str, workflow_commit: str | None = None) -> None:
    if not SHA_RE.fullmatch(source_sha):
        raise ValueError("source_sha must be 40 lowercase hex characters")
    if not ISSUE_RE.fullmatch(issue):
        raise ValueError("issue must be numeric")
    if workflow_commit is not None and not SHA_RE.fullmatch(workflow_commit):
        raise ValueError("workflow_commit must be 40 lowercase hex characters")


def artifact_name(source_sha: str, issue: str) -> str:
    validate(source_sha, issue)
    return f"issue-{issue}-exact-{source_sha}"


def render(source_sha: str, issue: str) -> str:
    validate(source_sha, issue)
    return f"""name: Ion exact-source Linux desktop artifact

on:
  push:
    branches:
      - {BRANCH}

permissions:
  contents: read

jobs:
  package-linux:
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - name: Checkout exact source
        uses: actions/checkout@v4
        with:
          ref: {source_sha}
          submodules: recursive
          persist-credentials: false
      - name: Cache GGUF model
        uses: actions/cache@v4
        with:
          path: backend/llm/backends/llamacpp/models/*.gguf
          key: gguf-model-granite-v2
          enableCrossOsArchive: true
      - name: Download GGUF model
        run: |
          if [ ! -f backend/llm/backends/llamacpp/models/granite-embedding-107m-multilingual-Q8_0.gguf ]; then
            mkdir -p backend/llm/backends/llamacpp/models
            curl -fSL -o backend/llm/backends/llamacpp/models/granite-embedding-107m-multilingual-Q8_0.gguf \\
              "https://huggingface.co/keisuke-miyako/granite-embedding-107m-multilingual-gguf-q8_0/resolve/main/granite-embedding-107m-multilingual-Q8_0.gguf?download=true"
          fi
      - uses: ./.github/actions/ci-setup
        with:
          matrix-os: ubuntu-latest
      - name: Build backend
        run: |
          mkdir -p plz-out/bin/backend
          go build -o plz-out/bin/backend/seed-daemon-x86_64-unknown-linux-gnu ./backend/cmd/seed-daemon
        env:
          GOARCH: amd64
          CGO_ENABLED: 1
          LIBRARY_PATH: ${{{{ github.workspace }}}}/backend/util/llama-go
          C_INCLUDE_PATH: ${{{{ github.workspace }}}}/backend/util/llama-go
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.3.10
      - name: Build agents server
        run: |
          cd agents
          bun install --frozen-lockfile
          bun scripts/build-binary.ts --target=x86_64-unknown-linux-gnu --smoke
      - name: Set temporary version
        run: node scripts/set-desktop-version.mjs
        env:
          VITE_VERSION: '0.0.{issue}'
      - name: Package Linux desktop without publishing
        run: pnpm desktop:make --arch=x64
        env:
          NODE_ENV: test
          NODE_OPTIONS: --max_old_space_size=8192
          DAEMON_NAME: x86_64-unknown-linux-gnu
          VITE_VERSION: '0.0.{issue}'
          VITE_COMMIT_HASH: '{source_sha}'
          VITE_DESKTOP_P2P_PORT: '57000'
          VITE_DESKTOP_HTTP_PORT: '57001'
          VITE_DESKTOP_GRPC_PORT: '57002'
          VITE_METRIC_SERVER_HTTP_PORT: '57003'
          VITE_DESKTOP_APPDATA: 'Seed-ion-{issue}-exact'
          VITE_DESKTOP_HOSTNAME: 'http://localhost'
          VITE_LIGHTNING_API_URL: 'https://ln.testnet.seed.hyper.media'
          VITE_SEED_HOST_URL: 'https://host-dev.seed.hyper.media'
          VITE_GATEWAY_URL: 'https://dev.hyper.media'
          VITE_NOTIFY_SERVICE_HOST: 'https://notify-dev.seed.hyper.media'
          SEED_P2P_TESTNET_NAME: dev
      - name: Record exact source
        run: |
          find frontend/apps/desktop/out/make -type f \\( -name '*.deb' -o -name '*.rpm' -o -name '*.AppImage' \\) -size +0c | grep -q .
          mkdir -p frontend/apps/desktop/out/make
          printf '%s\\n' '{source_sha}' > frontend/apps/desktop/out/make/ION-SOURCE-SHA.txt
      - uses: actions/upload-artifact@v4
        with:
          name: {artifact_name(source_sha, issue)}
          path: frontend/apps/desktop/out/make/**/*
          if-no-files-found: error
          retention-days: 14
"""


def load_token() -> str:
    for raw in Path('/workspace/ENV').read_text().splitlines():
        if raw.strip().startswith('GITHUB_PAT='):
            return raw.split('=', 1)[1].strip().strip('"').strip("'")
    raise RuntimeError('GITHUB_PAT missing from /workspace/ENV')


def request(path: str, token: str, method: str = 'GET', data=None) -> bytes:
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request('https://api.github.com' + path, data=body, method=method, headers={
        'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token,
        'User-Agent': 'Ion-exact-desktop-artifact', 'X-GitHub-Api-Version': '2022-11-28',
        **({'Content-Type': 'application/json'} if body is not None else {})})
    with urllib.request.urlopen(req, timeout=60) as response:
        return response.read()


def api(path: str, token: str, method: str = 'GET', data=None):
    raw = request(path, token, method, data)
    return json.loads(raw) if raw else {}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download_artifact_to_path(artifact_id: int, token: str, destination: Path) -> tuple[str, int]:
    initial = urllib.request.Request(
        f'{API}/actions/artifacts/{artifact_id}/zip',
        headers={'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + token,
                 'User-Agent': 'Ion-exact-desktop-artifact', 'X-GitHub-Api-Version': '2022-11-28'})
    opener = urllib.request.build_opener(NoRedirect())
    try:
        opener.open(initial, timeout=60)
        raise RuntimeError('GitHub artifact endpoint unexpectedly returned without a redirect')
    except urllib.error.HTTPError as error:
        if error.code not in {301, 302, 303, 307, 308}:
            raise
        location = error.headers.get('Location')
    parsed = urllib.parse.urlparse(location or '')
    host = (parsed.hostname or '').lower()
    allowed = host.endswith('.githubusercontent.com') or host.endswith('.actions.githubusercontent.com') or host.endswith('.blob.core.windows.net')
    if parsed.scheme != 'https' or not allowed:
        raise RuntimeError('GitHub returned an unapproved artifact download location')
    clean = urllib.request.Request(location, headers={'User-Agent': 'Ion-exact-desktop-artifact'})
    digest, size = hashlib.sha256(), 0
    with urllib.request.build_opener(NoRedirect()).open(clean, timeout=120) as response, destination.open('xb') as output:
        length = response.headers.get('Content-Length')
        if length is not None and int(length) > MAX_ARTIFACT_SIZE:
            raise RuntimeError('artifact exceeds download size limit')
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_ARTIFACT_SIZE:
                raise RuntimeError('artifact exceeds download size limit')
            output.write(chunk); digest.update(chunk)
        output.flush(); os.fsync(output.fileno())
    return digest.hexdigest(), size


def launch(source_sha: str, issue: str) -> dict:
    validate(source_sha, issue)
    text = render(source_sha, issue)
    token = load_token()
    try:
        api(f'/repos/{REPO}/git/ref/heads/{BRANCH}', token)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        main = api(f'/repos/{REPO}/git/ref/heads/main', token)
        api(f'/repos/{REPO}/git/refs', token, 'POST', {'ref': 'refs/heads/' + BRANCH, 'sha': main['object']['sha']})
    current = None
    try:
        current = api(f'/repos/{REPO}/contents/{WORKFLOW}?ref={BRANCH}', token)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    payload = {'message': f'ci: package exact source for #{issue}', 'branch': BRANCH,
               'content': base64.b64encode(text.encode()).decode()}
    if current:
        payload['sha'] = current['sha']
    out = api(f'/repos/{REPO}/contents/{WORKFLOW}', token, 'PUT', payload)
    return {'workflowCommit': out['commit']['sha'], 'sourceSha': source_sha, 'issue': issue,
            'branch': BRANCH, 'artifactName': artifact_name(source_sha, issue)}


def verify_workflow_commit(workflow_commit: str, source_sha: str, issue: str, token: str) -> None:
    validate(source_sha, issue, workflow_commit)
    item = api(f'/repos/{REPO}/contents/{WORKFLOW}?ref={workflow_commit}', token)
    try:
        encoded = ''.join(item['content'].split())
        actual = base64.b64decode(encoded, validate=True).decode()
    except (KeyError, ValueError, UnicodeDecodeError) as error:
        raise RuntimeError('workflow commit has malformed workflow content') from error
    if actual != render(source_sha, issue):
        raise RuntimeError('workflow commit does not match the requested source SHA and issue')


def find_run(workflow_commit: str, source_sha: str, issue: str, token: str) -> dict | None:
    verify_workflow_commit(workflow_commit, source_sha, issue, token)
    workflow = urllib.parse.quote(WORKFLOW, safe='')
    runs = api(f'/repos/{REPO}/actions/workflows/{workflow}/runs?branch={urllib.parse.quote(BRANCH)}&event=push&per_page=50', token)
    for run in runs.get('workflow_runs', []):
        if run.get('head_sha') == workflow_commit and run.get('head_branch') == BRANCH and run.get('event') == 'push':
            return run
    return None


def status(workflow_commit: str, source_sha: str, issue: str) -> dict:
    token = load_token()
    run = find_run(workflow_commit, source_sha, issue, token)
    if run is None:
        return {'state': 'awaiting-run', 'workflowCommit': workflow_commit, 'sourceSha': source_sha, 'issue': issue}
    return {'state': run['status'], 'conclusion': run.get('conclusion'), 'runId': run['id'],
            'runUrl': run['html_url'], 'workflowCommit': workflow_commit,
            'sourceSha': source_sha, 'issue': issue}


def wait_for_run(workflow_commit: str, source_sha: str, issue: str, timeout: int, interval: int) -> dict:
    if timeout < 1 or interval < 1:
        raise ValueError('timeout and interval must be positive')
    deadline = time.monotonic() + timeout
    while True:
        state = status(workflow_commit, source_sha, issue)
        if state['state'] == 'completed':
            if state['conclusion'] != 'success':
                raise RuntimeError(f"workflow run {state['runId']} concluded {state['conclusion']}")
            return state
        if time.monotonic() >= deadline:
            raise TimeoutError(f"workflow did not complete within {timeout} seconds; last state: {state['state']}")
        time.sleep(interval)


def verify_archive(raw: bytes | Path, source_sha: str) -> None:
    validate(source_sha, '0')
    try:
        source = io.BytesIO(raw) if isinstance(raw, bytes) else raw
        with zipfile.ZipFile(source) as archive:
            names = archive.namelist()
            manifests = [name for name in names if name == 'ION-SOURCE-SHA.txt' or name.endswith('/ION-SOURCE-SHA.txt')]
            packages = [name for name in names if Path(name).suffix in {'.deb', '.rpm', '.AppImage'} and archive.getinfo(name).file_size > 0]
            if len(manifests) != 1:
                raise RuntimeError(f'artifact must contain exactly one ION-SOURCE-SHA.txt; found {len(manifests)}')
            if not packages:
                raise RuntimeError('artifact contains no non-empty supported desktop package')
            expected = (source_sha + '\n').encode()
            embedded = archive.read(manifests[0])
            if embedded != expected:
                raise RuntimeError('artifact source manifest mismatch')
            bad = archive.testzip()
            if bad is not None:
                raise RuntimeError(f'artifact ZIP member failed CRC: {bad}')
    except zipfile.BadZipFile as error:
        raise RuntimeError('artifact download is not a ZIP archive') from error


def download(workflow_commit: str, source_sha: str, issue: str, destination: Path) -> dict:
    token = load_token()
    run = find_run(workflow_commit, source_sha, issue, token)
    if run is None or run.get('status') != 'completed' or run.get('conclusion') != 'success':
        raise RuntimeError('bound workflow run is not successfully completed')
    artifacts = api(f"/repos/{REPO}/actions/runs/{run['id']}/artifacts?per_page=100", token).get('artifacts', [])
    expected = artifact_name(source_sha, issue)
    matches = [item for item in artifacts if item.get('name') == expected and not item.get('expired')]
    if len(matches) != 1:
        raise RuntimeError(f'expected exactly one unexpired artifact named {expected}; found {len(matches)}')
    artifact = matches[0]
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = Path(tempfile.mkstemp(prefix=destination.name + '.', suffix='.tmp', dir=destination.parent)[1])
    temp.unlink()
    try:
        computed, size = download_artifact_to_path(artifact['id'], token, temp)
        verify_archive(temp, source_sha)
        digest = artifact.get('digest')
        if digest is not None and digest != 'sha256:' + computed:
            raise RuntimeError('artifact digest does not match GitHub metadata')
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    return {'runId': run['id'], 'runUrl': run['html_url'], 'artifactId': artifact['id'],
            'artifactName': expected, 'workflowCommit': workflow_commit, 'sourceSha': source_sha,
            'issue': issue, 'path': str(destination), 'sha256': computed,
            'size': size, 'manifestVerified': True}


def acquire(source_sha: str, issue: str, destination: Path, timeout: int, interval: int) -> dict:
    binding = launch(source_sha, issue)
    wait_for_run(binding['workflowCommit'], source_sha, issue, timeout, interval)
    return download(binding['workflowCommit'], source_sha, issue, destination)


def add_binding_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument('workflow_commit'); parser.add_argument('source_sha'); parser.add_argument('issue')


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd', required=True)
    for name in ('render', 'launch'):
        command = sub.add_parser(name); command.add_argument('source_sha'); command.add_argument('issue')
    command = sub.add_parser('status'); add_binding_args(command)
    command = sub.add_parser('wait'); add_binding_args(command)
    command.add_argument('--timeout', type=int, default=2700); command.add_argument('--interval', type=int, default=20)
    command = sub.add_parser('download'); add_binding_args(command); command.add_argument('destination', type=Path)
    command = sub.add_parser('acquire'); command.add_argument('source_sha'); command.add_argument('issue'); command.add_argument('destination', type=Path)
    command.add_argument('--timeout', type=int, default=2700); command.add_argument('--interval', type=int, default=20)
    args = parser.parse_args()
    if args.cmd == 'render': result = render(args.source_sha, args.issue); print(result, end=''); return
    if args.cmd == 'launch': result = launch(args.source_sha, args.issue)
    elif args.cmd == 'status': result = status(args.workflow_commit, args.source_sha, args.issue)
    elif args.cmd == 'wait': result = wait_for_run(args.workflow_commit, args.source_sha, args.issue, args.timeout, args.interval)
    elif args.cmd == 'download': result = download(args.workflow_commit, args.source_sha, args.issue, args.destination)
    else: result = acquire(args.source_sha, args.issue, args.destination, args.timeout, args.interval)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
