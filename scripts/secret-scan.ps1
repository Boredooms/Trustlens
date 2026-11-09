# Secret-pattern scan. Prints path:line and the PATTERN NAME only — never the matched value.
# Usage: pwsh scripts/secret-scan.ps1            (whole workspace, excluding deps/build output)
#        pwsh scripts/secret-scan.ps1 -Staged    (files staged in git; exit 1 on any hit)
param([switch]$Staged)
$patterns = [ordered]@{
  'clerk_secret'      = 'sk_(live|test)_[A-Za-z0-9]{20,}'
  'supabase_secret'   = 'sb_secret_[A-Za-z0-9_-]{16,}'
  'nvidia_key'        = 'nvapi-[A-Za-z0-9_-]{20,}'
  'qstash_signing'    = 'sig_[A-Za-z0-9]{20,}'
  'jwt_or_qstash_tok' = 'eyJ[A-Za-z0-9_=-]{40,}'
  'upstash_token'     = 'gQAAAAAAA[A-Za-z0-9]{20,}'
  'svix_secret'       = 'whsec_[A-Za-z0-9+/=]{20,}'
  'npm_token'         = 'npm_[A-Za-z0-9]{30,}'
  'private_key'       = 'BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY'
  'db_url_password'   = 'postgres(ql)?(\+\w+)?://[^:@/\s]+:[^@\s]{4,}@'
}
$root = Split-Path -Parent $PSScriptRoot
if ($Staged) {
  $files = git -C $root diff --cached --name-only --diff-filter=ACM | ForEach-Object { Join-Path $root $_ }
} else {
  $files = Get-ChildItem -Path $root -Recurse -File -Force | Where-Object {
    $_.FullName -notmatch '\\(node_modules|\.venv|\.git|dist|\.mypy_cache|\.ruff_cache|\.pytest_cache|artifacts|cache|__pycache__)\\' -and $_.Length -lt 5MB
  } | ForEach-Object { $_.FullName }
}
$hits = 0
foreach ($file in $files) {
  if (-not (Test-Path $file)) { continue }
  $lines = Get-Content -LiteralPath $file -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt $lines.Count; $i++) {
    foreach ($name in $patterns.Keys) {
      if ($lines[$i] -match $patterns[$name]) {
        $rel = $file.Substring($root.Length + 1)
        Write-Output "$rel`:$($i + 1)  [$name]"
        $hits++
      }
    }
  }
}
Write-Output "hits=$hits"
if ($Staged -and $hits -gt 0) { exit 1 }
