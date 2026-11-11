# lp-uxy.15.6 — project delete soft-archive honesty

**Shipped feature:** lp-uxy.5
**Base URL:** `http://demo.localhost:3010`
**Login:** `dev@demo.local`
**When:** 2026-08-05T14:18:49.123056+00:00
**Verdict:** **PASS**

## Acceptance

- [x] login: logged in as dev@demo.local (or existing session)
- [x] brain-rpc-enabled: brain_rpc_enabled=True kind=lanyard_agent profile=admin
- [x] backend-kind-lanyard-agent: kind=lanyard_agent
- [x] capabilities-projects-delete: projects.delete in methods=True features.projects_list=True projects_create=True
- [x] brain-ping: status=200 pong=True instance=1555e820-2eba-4e83-80bd-a93f3ae09e7c
- [x] marker-seeded: path=/home/operator/Lanyard/lp-uxy-15-6-soft-archive-qa/STAYS_ON_DISK.txt
- [x] create-disposable-project: reused existing id=p_f72fda60 primary=/home/operator/Lanyard/lp-uxy-15-6-soft-archive-qa
- [x] directory-shows-target-project: target=SoftArchiveQA project_id=p_f72fda60 qa_visible=True
- [x] project-actions-delete-visible: Delete control visible for SoftArchiveQA
- [x] soft-archive-confirm-copy: msg='Remove project “SoftArchiveQA” from Directory? This only archives the project registry entry — it leaves the list. Workspace and vault files stay on the agent disk (not deleted).' expected='Remove project “SoftArchiveQA” from Directory? This only archives the project registry entry — it leaves the list. Workspace and vault files stay on the agent disk (not deleted).' snippets_ok=True no_purge=True
- [x] project-left-directory-list: api_left=True ui_left=True after_count=8
- [x] vault-marker-stayed-on-disk: exists=True content_ok=True path=/home/operator/Lanyard/lp-uxy-15-6-soft-archive-qa/STAYS_ON_DISK.txt
- [x] delete-api-archived-true: status=200 body={'id': 'p_7932d587', 'archived': True}
- [x] vault-marker-stayed-after-api-delete: exists=True path=/home/operator/Lanyard/lp-uxy-15-6-soft-archive-qa/STAYS_ON_DISK.txt

## Soft-archive honesty

- confirm message: `Remove project “SoftArchiveQA” from Directory? This only archives the project registry entry — it leaves the list. Workspace and vault files stay on the agent disk (not deleted).`
- expected exact: `Remove project “SoftArchiveQA” from Directory? This only archives the project registry entry — it leaves the list. Workspace and vault files stay on the agent disk (not deleted).`
- DELETE body: `{'status': 200, 'body': {'id': 'p_7932d587', 'archived': True}}`
- marker path: `/home/operator/Lanyard/lp-uxy-15-6-soft-archive-qa/STAYS_ON_DISK.txt`
- marker after archive exists: `True`
- project left list after archive: `True`

## Screenshots

- `01-post-login.png`
- `02-directory-with-project.png`
- `03-project-actions-menu.png`
- `04-after-soft-archive.png`
- `05-final-directory.png`

## Fix bead

None (all checks green).

See `REPORT.json` for machine-readable results.
