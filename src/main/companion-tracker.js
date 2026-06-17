'use strict';

const { execFile } = require('node:child_process');

const POWERSHELL_WINDOW_RECT_SCRIPT = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32WindowRect {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
"@
$codexWindowPattern = "(?i)(^codex$|openai\\.codex|codex desktop|codex)"
$excludedWindowPattern = "(?i)(chrome|edge|firefox|browser|powershell|terminal|cmd|visual studio code)"
$processes = Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and
  $_.MainWindowTitle -and
  (
    $_.ProcessName -match $codexWindowPattern -or
    $_.MainWindowTitle -match $codexWindowPattern
  )
} | Where-Object {
  $_.ProcessName -notmatch $excludedWindowPattern
} | Sort-Object @{
  Expression = {
    if ($_.ProcessName -match "(?i)^codex$|openai\\.codex") { 0 }
    elseif ($_.MainWindowTitle -match "(?i)codex") { 1 }
    else { 2 }
  }
}, ProcessName
foreach ($process in $processes) {
  $handle = [IntPtr]$process.MainWindowHandle
  if (-not [Win32WindowRect]::IsWindowVisible($handle)) { continue }
  $rect = New-Object Win32WindowRect+RECT
  if ([Win32WindowRect]::GetWindowRect($handle, [ref]$rect)) {
    [PSCustomObject]@{
      found = $true
      processName = $process.ProcessName
      title = $process.MainWindowTitle
      x = $rect.Left
      y = $rect.Top
      width = [Math]::Max(0, $rect.Right - $rect.Left)
      height = [Math]::Max(0, $rect.Bottom - $rect.Top)
    } | ConvertTo-Json -Compress
    exit 0
  }
}
[PSCustomObject]@{ found = $false } | ConvertTo-Json -Compress
`;

function readCodexWindowBounds({ timeoutMs = 1200 } = {}) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', POWERSHELL_WINDOW_RECT_SCRIPT],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout) => {
        if (error || !stdout) {
          resolve({ found: false });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout).trim());
          if (!parsed || parsed.found !== true) {
            resolve({ found: false });
            return;
          }
          resolve({
            found: true,
            processName: String(parsed.processName || ''),
            title: String(parsed.title || ''),
            x: Number(parsed.x) || 0,
            y: Number(parsed.y) || 0,
            width: Number(parsed.width) || 0,
            height: Number(parsed.height) || 0,
          });
        } catch (_) {
          resolve({ found: false });
        }
      },
    );
  });
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function companionBoundsForCodex(codexBounds, companionSize, workArea) {
  const width = Math.max(1, companionSize.width || 320);
  const height = Math.max(1, companionSize.height || 44);
  const area = workArea || { x: 0, y: 0, width: 1920, height: 1080 };
  const preferredX = codexBounds.x + Math.round((codexBounds.width - width) / 2);
  const outsideTop = codexBounds.y - height - 8;
  const insideTop = codexBounds.y + 12;
  const preferredY = outsideTop >= area.y ? outsideTop : insideTop;

  return {
    x: clamp(preferredX, area.x, area.x + area.width - width),
    y: clamp(preferredY, area.y, area.y + area.height - height),
    width,
    height,
  };
}

module.exports = {
  companionBoundsForCodex,
  readCodexWindowBounds,
};
