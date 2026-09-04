# Verify /loop command is in the binary you're running
#
# Usage:
#   powershell -File verify-loop.ps1 -Binary "path\to\opencode.exe"
#
# If you don't pass -Binary, it checks the repo's dist build.

param(
  [string]$Binary = "$PSScriptRoot\..\packages\opencode\dist\opencode-windows-x64\bin\opencode.exe"
)

if (-not (Test-Path $Binary)) {
  Write-Host "ERROR: Binary not found: $Binary" -ForegroundColor Red
  Write-Host "Build it first:  cd packages\opencode ; bun run script/build.ts --single --skip-install"
  exit 1
}

$info = Get-Item $Binary
Write-Host "Checking: $($info.FullName)"
Write-Host "Built at: $($info.LastWriteTime)"
Write-Host ""

$bytes = [System.IO.File]::ReadAllBytes($Binary)
$text = [System.Text.Encoding]::ASCII.GetString($bytes)

$checks = @(
  @{ Name = "/loop command (Set loop count)"; Pattern = "Set loop count" },
  @{ Name = "Dialog title (Set Loop Count)"; Pattern = "Set Loop Count" },
  @{ Name = "loop_count API param"; Pattern = "loop_count" },
  @{ Name = "loop state persistence"; Pattern = "loop.json" },
  @{ Name = "optional chaining fix"; Pattern = "loop?.get" }
)

$allFound = $true
foreach ($c in $checks) {
  if ($text -match [regex]::Escape($c.Pattern)) {
    Write-Host "  [OK]      $($c.Name)" -ForegroundColor Green
  } else {
    Write-Host "  [MISSING] $($c.Name)" -ForegroundColor Red
    $allFound = $false
  }
}

Write-Host ""
if ($allFound) {
  Write-Host "PASS: The binary contains the /loop command." -ForegroundColor Green
  Write-Host "If /loop still doesn't show in the TUI, you are running a DIFFERENT binary."
  Write-Host "Run this script with the binary you actually launch:"
  Write-Host "  powershell -File verify-loop.ps1 -Binary 'C:\path\to\your\opencode.exe'"
} else {
  Write-Host "FAIL: This binary is stale. Rebuild it:" -ForegroundColor Red
  Write-Host "  cd packages\opencode"
  Write-Host "  bun run script/build.ts --single --skip-install"
}
