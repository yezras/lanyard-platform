#!/usr/bin/env python3
"""Minimal gws Gmail draft creator for post-meeting-triage.
Copy to /tmp, set BODY/TO/SUBJECT, run: python3 /tmp/gws-draft-create.py
"""
import json
import base64
import subprocess
from email.mime.text import MIMEText

# --- edit these ---
TO = "recipient@example.com"
SUBJECT = "Next Steps: Project Name"
BODY = """Hi FirstName,

...paragraph narrative per email-type/*.md...

<LanyardOperator>"""
# ------------------

msg = MIMEText(BODY, "plain", "utf-8")
msg["To"] = TO
msg["From"] = "<SenderEmail>"
msg["Subject"] = SUBJECT

raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
payload = {"message": {"raw": raw}}
json_path = "/tmp/draft_payload.json"
with open(json_path, "w") as f:
    json.dump(payload, f)

r = subprocess.run(
    [
        "gws",
        "gmail",
        "users",
        "drafts",
        "create",
        "--params",
        '{"userId":"me"}',
        "--json",
        open(json_path).read(),
    ],
    capture_output=True,
    text=True,
)
print("exit", r.returncode)
print(r.stdout)
if r.stderr:
    print("stderr:", r.stderr)
raise SystemExit(r.returncode)