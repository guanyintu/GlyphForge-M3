# Synthetic-only Windows PowerShell 5.1 -> WSL UTF-8 pipe compatibility test.
# No real vault, user account or credential access.
$ErrorActionPreference = 'Stop'
$data = '{"a":"synthetic","b":"test-only"}'
$bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($data)
$hash = [System.Security.Cryptography.SHA256]::Create()
try {
  $expected = [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
  $psi = [System.Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = Join-Path $env:WINDIR 'System32\wsl.exe'
  $psi.Arguments = '--exec /usr/bin/sha256sum'
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $false
  $proc = [System.Diagnostics.Process]::new()
  $proc.StartInfo = $psi
  try {
    if (-not $proc.Start()) { throw 'WSL launch failed' }
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.BaseStream.Flush()
    $proc.StandardInput.Close()
    $actual = $proc.StandardOutput.ReadToEnd().Trim().Split(' ')[0]
    $proc.WaitForExit()
    if ($proc.ExitCode -ne 0 -or $actual -ne $expected) {
      throw 'Synthetic pipe SHA256 mismatch'
    }
    Write-Output 'WSL_UTF8_PIPE=PASS (synthetic data only)'
  } finally { $proc.Dispose() }
} finally {
  [Array]::Clear($bytes, 0, $bytes.Length)
  $hash.Dispose()
}
