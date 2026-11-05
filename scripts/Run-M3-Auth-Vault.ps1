param(
  [ValidateSet('Run','Save','Forget','Status','SelfTest')]
  [string]$Action = 'Run'
)
# Windows-only, current-user DPAPI; synthetic test accounts only.
# Secrets stay out of project files, command-line arguments, chat, and logs.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VaultDir = Join-Path $env:LOCALAPPDATA 'GlyphForge\M3Auth'
$AuthorFile = Join-Path $VaultDir 'test-a.clixml'
$ReaderFile = Join-Path $VaultDir 'test-b.clixml'

function Save-Vault {
  if (-not [Environment]::UserInteractive) { throw 'Interactive Windows session required.' }
  Write-Host 'First run: enter two Supabase TEST accounts below. No pop-up window is needed.'
  $emailA = (Read-Host 'Account A email').Trim()
  $passwordA = Read-Host 'Account A password (hidden)' -AsSecureString
  $emailB = (Read-Host 'Account B email').Trim()
  $passwordB = Read-Host 'Account B password (hidden)' -AsSecureString
  if ([string]::IsNullOrWhiteSpace($emailA) -or [string]::IsNullOrWhiteSpace($emailB) -or
      $emailA -eq $emailB -or $passwordA.Length -eq 0 -or $passwordB.Length -eq 0) {
    throw 'Two different accounts with nonempty passwords are required.'
  }
  $a = [System.Management.Automation.PSCredential]::new($emailA, $passwordA)
  $b = [System.Management.Automation.PSCredential]::new($emailB, $passwordB)
  if (-not (Test-Path -LiteralPath $VaultDir)) {
    New-Item -ItemType Directory -Path $VaultDir -Force | Out-Null
  }
  $tmpA = Join-Path $VaultDir ('a-' + [guid]::NewGuid().ToString('N') + '.xml')
  $tmpB = Join-Path $VaultDir ('b-' + [guid]::NewGuid().ToString('N') + '.xml')
  try {
    $a | Export-Clixml -LiteralPath $tmpA
    $b | Export-Clixml -LiteralPath $tmpB
    Move-Item -LiteralPath $tmpA -Destination $AuthorFile -Force
    Move-Item -LiteralPath $tmpB -Destination $ReaderFile -Force
  } finally {
    Remove-Item -LiteralPath $tmpA, $tmpB -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'Two test credentials saved in Windows current-user DPAPI encrypted storage.'
  Write-Host 'Use -Action Forget to remove the local saved credentials after acceptance.'
}

function Test-Vault {
  return ((Test-Path -LiteralPath $AuthorFile) -and (Test-Path -LiteralPath $ReaderFile))
}

function Run-CloudSmoke {
  if (-not (Test-Vault)) { Save-Vault }
  $a = Import-Clixml -LiteralPath $AuthorFile
  $b = Import-Clixml -LiteralPath $ReaderFile
  if ($a -isnot [System.Management.Automation.PSCredential] -or
      $b -isnot [System.Management.Automation.PSCredential] -or
      $a.UserName -eq $b.UserName) {
    throw 'Invalid vault; use -Action Save to replace it.'
  }
  # A local anonymous pipe, not process argv or WSL environment, carries credentials.
  # Plaintext exists transiently in this one PowerShell process and its WSL child.
  $payload = @{
    a = @{ email = $a.UserName; password = $a.GetNetworkCredential().Password }
    b = @{ email = $b.UserName; password = $b.GetNetworkCredential().Password }
  } | ConvertTo-Json -Compress -Depth 4
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = Join-Path $env:WINDIR 'System32\wsl.exe'
  $psi.Arguments = '--cd "' + $ProjectRoot + '" --exec /bin/bash scripts/run-community-auth-piped.sh'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  # Windows PowerShell 5.1/.NET Framework has no ProcessStartInfo.StandardInputEncoding.
  # Write explicit UTF-8 bytes to the anonymous pipe instead of relying on code pages.
  $psi.RedirectStandardOutput = $false
  $psi.RedirectStandardError = $false
  $psi.CreateNoWindow = $false
  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  try {
    if (-not $proc.Start()) { throw 'Could not start WSL.' }
    $utf8 = [System.Text.UTF8Encoding]::new($false)
    $bytes = $utf8.GetBytes($payload)
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.BaseStream.Flush()
    $proc.StandardInput.Close()
    [Array]::Clear($bytes, 0, $bytes.Length)
    $bytes = $null
    $payload = $null
    $a = $null
    $b = $null
    $proc.WaitForExit()
    Write-Host ('M3-A read-only Auth smoke finished (exit ' + $proc.ExitCode + ').')
    return $proc.ExitCode
  } finally {
    $payload = $null
    if (-not $proc.HasExited) { $proc.Kill() }
    $proc.Dispose()
  }
}

function SelfTest-DPAPI {
  $testFile = Join-Path $env:TEMP ('glyphforge-m3-dpapi-check-' + [guid]::NewGuid().ToString('N') + '.xml')
  $dummyPassword = 'nonsecret-synthetic-fixture-only'
  try {
    $secure = ConvertTo-SecureString $dummyPassword -AsPlainText -Force
    $original = New-Object System.Management.Automation.PSCredential('test@example.invalid', $secure)
    $original | Export-Clixml -LiteralPath $testFile
    $saved = [System.IO.File]::ReadAllText($testFile)
    if ($saved.Contains($dummyPassword)) { throw 'Test file unexpectedly contains plaintext.' }
    $loaded = Import-Clixml -LiteralPath $testFile
    if ($loaded -isnot [System.Management.Automation.PSCredential] -or
        $loaded.GetNetworkCredential().Password -ne $dummyPassword) { throw 'DPAPI round-trip failed.' }
    Write-Host 'DPAPI_SELFTEST=PASS (synthetic only, no real accounts accessed)'
  } finally {
    Remove-Item -LiteralPath $testFile -Force -ErrorAction SilentlyContinue
  }
}

try {
  switch ($Action) {
    'Status' {
      if (Test-Vault) { Write-Host 'M3_TEST_VAULT=READY (encrypted; no credentials displayed)' }
      else { Write-Host 'M3_TEST_VAULT=EMPTY' }
    }
    'Save' { Save-Vault }
    'Forget' {
      Remove-Item -LiteralPath $AuthorFile, $ReaderFile -Force -ErrorAction SilentlyContinue
      Write-Host 'M3_TEST_VAULT=FORGOTTEN (local encrypted files deleted; cloud users unchanged)'
    }
    'SelfTest' { SelfTest-DPAPI }
    'Run' { exit (Run-CloudSmoke) }
  }
} catch {
  Write-Host 'M3_AUTH_VAULT=BLOCKED. Check Windows user session, WSL and test-account credentials.'
  exit 2
}
