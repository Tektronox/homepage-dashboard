---
name: public-readiness-audit
description: "Audit a repository for public release readiness. Use when: preparing to open-source a repo, checking for secrets or credentials, scanning git history for sensitive data, reviewing .gitignore coverage, or getting a go/no-go decision before making a repo public. Triggers: 'ready to be public', 'audit for secrets', 'open source check', 'public repo audit', 'check for credentials', 'is this safe to publish'."
argument-hint: "Optional: focus area (e.g. 'git history only', 'config files only')"
---

# Public Readiness Audit

Performs a thorough security and hygiene audit before making a repository public. Produces a severity-ranked findings report and a final go/no-go recommendation.

## Audit Scope

1. **Current file tree** — secrets, credentials, private keys, tokens
2. **Git history** — commits and diffs for sensitive data ever committed
3. **Sensitive file types** — `.env`, key files, certificates, credential stores
4. **Config files** — hardcoded IPs, hostnames, passwords, API endpoints
5. **.gitignore coverage** — whether likely-sensitive paths are excluded
6. **Docker / CI config** — env vars, build args, inline secrets
7. **README and docs** — accidental credential examples, internal URLs

## Procedure

### Step 1 — Run the automated scan

Execute [./scripts/audit.sh](./scripts/audit.sh) from the repository root.  
The script outputs findings grouped by category and pre-tagged with severity.

```
bash .github/skills/public-readiness-audit/scripts/audit.sh 2>&1 | tee /tmp/audit-results.txt
```

### Step 2 — Review git history

Run the git-history portion manually if the script flags `GIT_HISTORY`:

```bash
# Show all commit messages that might contain secrets
git log --all --oneline | grep -iE 'password|secret|token|key|credential|api.?key'

# Search all diffs ever committed
git log --all -p | grep -iE '(password|secret|token|api.?key|private.?key)\s*[:=]' | head -60
```

### Step 3 — Inspect flagged files

For each flagged file, read it and determine:
- Is the value a real secret or a placeholder?
- Is the file tracked by git (use `git ls-files <file>`)?
- Does `.gitignore` already exclude it?

### Step 4 — Compile findings report

Use the severity table below. List every finding:

| # | Severity | File / Location | Description | Remediation |
|---|----------|----------------|-------------|-------------|
| 1 | CRITICAL | … | … | … |

#### Severity definitions

| Severity | Meaning |
|----------|---------|
| **CRITICAL** | Real secret/credential present in tracked files or git history — must fix before going public |
| **HIGH** | Sensitive file tracked, internal hostname/IP exposed, or weak .gitignore |
| **MEDIUM** | Placeholder that looks like a secret, commented-out credential, non-sensitive personal data |
| **LOW** | Cosmetic or policy issue (e.g. no LICENSE file, TODO with username) |
| **INFO** | Observation with no security impact |

### Step 5 — Go / No-Go decision

Apply this decision matrix:

| Condition | Decision |
|-----------|----------|
| Any **CRITICAL** finding | ❌ NO-GO — block until resolved |
| Any **HIGH** finding | ⚠️ CONDITIONAL — resolve or document accepted risk |
| Only **MEDIUM / LOW / INFO** | ✅ GO — with notes |
| Zero findings | ✅ GO |

State the decision explicitly at the top of the report:

```
## Audit Result: ❌ NO-GO  (or ✅ GO / ⚠️ CONDITIONAL)
Reason: <one line>
```

### Step 6 — Remediation guidance

For each CRITICAL or HIGH finding, provide the exact remediation command:

- **Secret in working tree**: remove value, rotate the credential, update `.gitignore`
- **Secret in git history**: `git filter-repo --path <file> --invert-paths` or BFG Repo Cleaner; then force-push
- **Sensitive file tracked**: `git rm --cached <file>` + add to `.gitignore`
- **Hardcoded config**: move to environment variable or secrets manager

## Output Format

```
# Public Readiness Audit — <repo name> — <date>

## Audit Result: ❌ NO-GO | ⚠️ CONDITIONAL | ✅ GO
Reason: …

## Findings

| # | Severity | Location | Description | Remediation |
|---|----------|----------|-------------|-------------|
…

## Summary
- CRITICAL: N
- HIGH: N
- MEDIUM: N
- LOW: N
- INFO: N

## Next Steps
…
```
