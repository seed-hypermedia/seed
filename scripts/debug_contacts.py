#!/usr/bin/env python3
"""
Seed duplicate-contacts diagnostic.
Usage:
  python3 debug_contacts.py [path/to/db.sqlite]

Typical paths:
  macOS:   ~/Library/Application Support/Seed-dev/daemon/db/db.sqlite
  Linux:   ~/.config/Seed-dev/daemon/db/db.sqlite
  Windows: %APPDATA%\\Seed-dev\\daemon\\db\\db.sqlite

Requires: pip3 install apsw
"""
import sys, os
from collections import defaultdict

try:
    import apsw
except ImportError:
    print("apsw not installed. Run: pip3 install apsw")
    sys.exit(1)

# --- locate the db ---
if len(sys.argv) > 1:
    db_path = sys.argv[1]
else:
    candidates = [
        os.path.expanduser("~/Library/Application Support/Seed-dev/daemon/db/db.sqlite"),
        os.path.expanduser("~/.config/Seed-dev/daemon/db/db.sqlite"),
        os.path.join(os.environ.get("APPDATA", ""), "Seed-dev", "daemon", "db", "db.sqlite"),
    ]
    db_path = next((p for p in candidates if os.path.exists(p)), None)
    if not db_path:
        print("Could not find Seed DB. Pass path as argument.")
        sys.exit(1)

print(f"Opening: {db_path}\n")
db = apsw.Connection(db_path, flags=apsw.SQLITE_OPEN_READONLY)
cur = db.cursor()

query = """
  SELECT
    pk_signer.principal                   AS signer,
    COALESCE(pk_account.principal, '')    AS account_explicit,
    COALESCE(pk_subject.principal, '??')  AS subject,
    sb.extra_attrs->>'tsid'               AS tsid,
    sb.extra_attrs->>'name'               AS name,
    sb.ts,
    json(sb.extra_attrs->'subscribe')     AS subscribe
  FROM structural_blobs sb
  JOIN  public_keys pk_signer   ON pk_signer.id   = sb.author
  LEFT JOIN public_keys pk_account ON pk_account.id = (sb.extra_attrs->>'subject')
  LEFT JOIN public_keys pk_subject ON pk_subject.id = (sb.extra_attrs->>'subject')
  WHERE sb.type = 'Contact'
    AND sb.extra_attrs->>'deleted' IS NULL
  ORDER BY subject, sb.ts DESC
"""

rows = list(cur.execute(query))
print(f"Total active Contact blobs: {len(rows)}\n")

by_subject = defaultdict(list)
for r in rows:
    by_subject[r[2]].append(r)  # group by subject

print("=" * 60)
print("DUPLICATE CONTACTS (same subject, >1 record)")
print("=" * 60)
has_dupes = False

for subj, records in sorted(by_subject.items(), key=lambda x: -len(x[1])):
    if len(records) < 2:
        continue
    has_dupes = True
    name_sample = records[0][4] or "(no name)"
    print(f"\nSubject : {subj}")
    print(f"Name    : {name_sample!r}")
    print(f"Records : {len(records)}")

    signers = set(r[0] for r in records)
    accounts = set(r[1] for r in records if r[1])

    for i, (signer, acct_exp, subj2, tsid, name, ts, sub) in enumerate(records):
        marker = ""
        if i > 0:
            marker = "  ← DIFFERENT SIGNER" if signer != records[0][0] else "  ← SAME SIGNER"
        tsid_s = (tsid or "")[:12] + "…"
        sign_s = signer[:16] + "…"
        print(f"  [{i+1}] ts={ts}  tsid={tsid_s}  signer={sign_s}  sub={sub}{marker}")

    if len(signers) == 1:
        print(f"\n  *** VERDICT: ALL SAME SIGNER")
        print(f"      → Hypothesis 2 (delegated keys) RULED OUT")
        print(f"      → Hypothesis 1 confirmed: repeated createContact calls")
        print(f"        (race condition or postAccountCreateAction re-running)")
    else:
        print(f"\n  *** VERDICT: {len(signers)} DIFFERENT SIGNERS")
        print(f"      → Hypothesis 2 confirmed: different delegated keys each created")
        print(f"        their own contact blob for the same subject")
        if len(signers) == len(records):
            print(f"      → Every record has a unique signer (one per key)")

if not has_dupes:
    print("No duplicates found.\n")
    print("All contacts:")
    for subj, records in by_subject.items():
        print(f"  {subj[:24]}…  {len(records)}x  name={records[0][4]!r}")
