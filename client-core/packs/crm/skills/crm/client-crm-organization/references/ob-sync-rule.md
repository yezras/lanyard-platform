# Mandatory ob sync Rule

After **any** creation or modification of a markdown file inside the Lanyard vault (`<VaultRoot>`):

```bash
cd <VaultRoot> && ob sync
```

**Exceptions:**
- Only skip if a git repository exists in the target folder **and** the current branch is not master.

**Rationale:**
- Ensures cloud vault (Obsidian Sync) stays in sync with local changes.
- Prevents agent memory drift across sessions.
- Protects against data loss when working with structured client notes and AGENTS.md files.

This rule was established as a hard requirement for all Lanyard vault operations.