#!/usr/bin/env bash
# public-readiness-audit/scripts/audit.sh
# Scans a git repository for secrets, sensitive files, and hygiene issues.
# Run from the repository root.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

CRITICAL=0
HIGH=0
MEDIUM=0
LOW=0
INFO=0

sep() { echo "────────────────────────────────────────────────────────"; }
finding() {
  local severity="$1" location="$2" description="$3" remediation="$4"
  case "$severity" in
    CRITICAL) CRITICAL=$((CRITICAL+1)) ;;
    HIGH)     HIGH=$((HIGH+1)) ;;
    MEDIUM)   MEDIUM=$((MEDIUM+1)) ;;
    LOW)      LOW=$((LOW+1)) ;;
    INFO)     INFO=$((INFO+1)) ;;
  esac
  printf "  [%-8s] %-35s %s\n" "$severity" "$location" "$description"
  printf "             Remediation: %s\n" "$remediation"
}

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║         PUBLIC READINESS AUDIT                       ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  Repo : $REPO_ROOT"
echo "  Date : $(date -u '+%Y-%m-%d %H:%M UTC')"
sep

# ── 1. Sensitive file types ────────────────────────────────
echo ""
echo "## 1. Sensitive file types"
echo ""

SENSITIVE_PATTERNS=(
  "*.pem" "*.key" "*.p12" "*.pfx" "*.crt" "*.cer"
  ".env" ".env.*" "*.env"
  "id_rsa" "id_ecdsa" "id_ed25519" "*.ppk"
  "credentials" "*.credentials" "*.secret"
  "secrets.json" "secrets.yaml" "secrets.yml"
  "serviceAccountKey.json"
  ".htpasswd" "*.keystore"
)

for pat in "${SENSITIVE_PATTERNS[@]}"; do
  while IFS= read -r -d '' f; do
    tracked=$(git ls-files "$f" 2>/dev/null)
    if [[ -n "$tracked" ]]; then
      finding "CRITICAL" "$f" "Sensitive file type tracked by git" \
        "git rm --cached '$f' && echo '$f' >> .gitignore"
    else
      finding "HIGH" "$f" "Sensitive file exists but not git-tracked" \
        "Verify it's in .gitignore: echo '$f' >> .gitignore"
    fi
  done < <(find . -name "$pat" -not -path './.git/*' -print0 2>/dev/null)
done

# ── 2. Secret patterns in tracked files ───────────────────
echo ""
echo "## 2. Secret patterns in current tracked files"
echo ""

SECRET_REGEX='(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token|bearer|client[_-]?secret|db[_-]?pass|database[_-]?url)\s*[:=]\s*["\x27]?[A-Za-z0-9/+_\-]{8,}'

if git ls-files | xargs grep -rniP "$SECRET_REGEX" -- 2>/dev/null | grep -v "example\|placeholder\|your.key\|<.*>\|TODO\|FIXME\|xxx\|test\|fake\|dummy" | head -30 > /tmp/_audit_secrets.txt 2>/dev/null; then
  while IFS= read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    lineno=$(echo "$line" | cut -d: -f2)
    finding "CRITICAL" "${file}:${lineno}" "Possible secret/credential value" \
      "Replace with env var; rotate the credential immediately"
  done < /tmp/_audit_secrets.txt
fi
rm -f /tmp/_audit_secrets.txt

# ── 3. Hardcoded IPs / internal hostnames ─────────────────
echo ""
echo "## 3. Internal IPs and hostnames in tracked files"
echo ""

IP_REGEX='(10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]+\.[0-9]+|192\.168\.[0-9]+\.[0-9]+)'
if git ls-files | xargs grep -rniP "$IP_REGEX" -- 2>/dev/null | head -20 > /tmp/_audit_ips.txt 2>/dev/null; then
  while IFS= read -r line; do
    file=$(echo "$line" | cut -d: -f1)
    lineno=$(echo "$line" | cut -d: -f2)
    finding "HIGH" "${file}:${lineno}" "Private/internal IP address" \
      "Replace with config var or env variable"
  done < /tmp/_audit_ips.txt
fi
rm -f /tmp/_audit_ips.txt /tmp/_audit_hist.txt /tmp/_audit_msgs.txt

# ── 4. Git history — secret patterns ──────────────────────
echo ""
echo "## 4. Git history secret scan"
echo ""

HIST_REGEX='(password|secret|token|api[_-]?key|private[_-]?key|access[_-]?key)\s*[:=]\s*["\x27]?[A-Za-z0-9/+_\-]{8,}'
git log --all -p 2>/dev/null \
  | grep -niP "$HIST_REGEX" 2>/dev/null \
  | grep -v "example\|placeholder\|your.key\|<.*>\|TODO\|xxx\|test\|fake\|dummy" \
  > /tmp/_audit_hist.txt 2>/dev/null || true
HIST_HITS=$(wc -l < /tmp/_audit_hist.txt)
HIST_HITS=$((HIST_HITS+0))

if [[ $HIST_HITS -gt 0 ]]; then
  finding "CRITICAL" "git history" \
    "$HIST_HITS line(s) matching secret patterns found in commit history" \
    "Use 'git filter-repo' or BFG Repo Cleaner to purge; rotate credentials"
  echo "  GIT_HISTORY: run manually to inspect —"
  echo "    git log --all -p | grep -niP '$HIST_REGEX' | head -40"
else
  finding "INFO" "git history" "No obvious secret patterns in commit history" "None"
fi

# ── 5. Git commit messages ────────────────────────────────
echo ""
echo "## 5. Git commit messages"
echo ""

git log --all --oneline 2>/dev/null \
  | grep -iE 'password|secret|token|api.?key|credential' \
  > /tmp/_audit_msgs.txt 2>/dev/null || true
MSG_HITS=$(wc -l < /tmp/_audit_msgs.txt)
MSG_HITS=$((MSG_HITS+0))
if [[ $MSG_HITS -gt 0 ]]; then
  finding "MEDIUM" "git log" \
    "$MSG_HITS commit message(s) contain sensitive keywords" \
    "Review with: git log --all --oneline | grep -iE 'password|secret|token|api.?key'"
else
  finding "INFO" "git log" "No sensitive keywords in commit messages" "None"
fi

# ── 6. .gitignore coverage ────────────────────────────────
echo ""
echo "## 6. .gitignore coverage"
echo ""

SHOULD_IGNORE=(".env" "*.pem" "*.key" "node_modules" ".DS_Store" "*.log")
if [[ -f .gitignore ]]; then
  for entry in "${SHOULD_IGNORE[@]}"; do
    if ! grep -qF "$entry" .gitignore 2>/dev/null; then
      finding "LOW" ".gitignore" "Missing recommended entry: $entry" \
        "echo '$entry' >> .gitignore"
    fi
  done
else
  finding "HIGH" ".gitignore" ".gitignore file does not exist" \
    "Create a .gitignore — see github.com/github/gitignore for templates"
fi

# ── 7. Docker / CI environment variables ─────────────────
echo ""
echo "## 7. Dockerfile / CI config inline secrets"
echo ""

CI_FILES=()
while IFS= read -r -d '' f; do CI_FILES+=("$f"); done < <(
  find . \( -name 'Dockerfile' -o -name 'docker-compose*.yml' \
    -o -name '.github' -prune \
    -o -name '*.yml' -o -name '*.yaml' \) \
    -not -path './.git/*' -print0 2>/dev/null
)

for f in "${CI_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -niP '(ENV|ARG|--build-arg|password|secret|token)\s+\S+=\S{6,}' "$f" 2>/dev/null \
      | grep -qv 'example\|placeholder\|<.*>' 2>/dev/null; then
    finding "HIGH" "$f" "Possible secret in Dockerfile/CI ENV or ARG" \
      "Use Docker secrets or CI secret store instead of inline values"
  fi
done

# ── 8. Hygiene checks ─────────────────────────────────────
echo ""
echo "## 8. Repository hygiene"
echo ""

[[ -f README.md ]] || finding "LOW" "README.md" "No README.md found" "Add a README before going public"
[[ -f LICENSE ]] || [[ -f LICENSE.md ]] || [[ -f LICENSE.txt ]] \
  || finding "LOW" "LICENSE" "No LICENSE file found" \
       "Choose a license at choosealicense.com and add a LICENSE file"
[[ -f .gitignore ]] || true  # already handled above

# ── Summary ───────────────────────────────────────────────
sep
echo ""
echo "## Summary"
printf "  CRITICAL : %d\n" "$CRITICAL"
printf "  HIGH     : %d\n" "$HIGH"
printf "  MEDIUM   : %d\n" "$MEDIUM"
printf "  LOW      : %d\n" "$LOW"
printf "  INFO     : %d\n" "$INFO"
echo ""

if [[ $CRITICAL -gt 0 ]]; then
  echo "## Audit Result: ❌  NO-GO"
  echo "   Reason: $CRITICAL CRITICAL finding(s) must be resolved before publishing."
elif [[ $HIGH -gt 0 ]]; then
  echo "## Audit Result: ⚠️  CONDITIONAL"
  echo "   Reason: $HIGH HIGH finding(s) — resolve or document accepted risk."
else
  echo "## Audit Result: ✅  GO"
  echo "   Reason: No CRITICAL or HIGH findings."
fi
echo ""
