// System-tray helper, run by the PowerShell 5.1 that ships with every Windows 10/11 install.
// Written to %LOCALAPPDATA%\ChatGPTChromeConnector\tray.ps1 at runtime, so it lives inside the exe.
// NOTE: kept free of backticks and dollar-brace sequences because this is a JS template string.
export const TRAY_PS1 = String.raw`
param(
  [int]$Port = 8765,
  [string]$IconPath = "",
  [string]$StartExe = "",
  [string]$StartArgs = "none",
  [string]$WindowTitle = "ChatGPT Chrome Connector - Control Panel"
)
$ErrorActionPreference = 'Stop'

# One tray icon per user session. Exit code 3 tells the connector another copy owns it.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\ChatGPTChromeConnectorTray', [ref]$created)
if (-not $created) { exit 3 }

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class CcWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      StringBuilder sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.ToString() == title) {
        StringBuilder c = new StringBuilder(256); GetClassName(h, c, 256);
        if (c.ToString().StartsWith("Chrome_WidgetWin")) { found = h; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$base = "http://127.0.0.1:" + $Port
$script:hwnd = [IntPtr]::Zero
$script:lastCmd = 0
$script:fails = 0
$script:state = 'starting'
$script:url = $null
$script:settings = $null
$script:balloonCopy = $null
$script:toldAboutTray = $false
$script:everUp = $false

function Invoke-Api([string]$Method, [string]$Path, [string]$Body) {
  $req = [System.Net.HttpWebRequest]::Create($base + $Path)
  $req.Method = $Method
  $req.Timeout = 1500
  $req.ReadWriteTimeout = 1500
  $req.Proxy = $null
  $req.Headers.Add('x-connector', '1')
  if ($Method -eq 'POST') {
    if (-not $Body) { $Body = '{}' }
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $req.ContentType = 'application/json'
    $req.ContentLength = $bytes.Length
    $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  }
  $resp = $req.GetResponse()
  try { $txt = (New-Object System.IO.StreamReader($resp.GetResponseStream())).ReadToEnd() } finally { $resp.Close() }
  if ($txt) { return ($txt | ConvertFrom-Json) }
  return $null
}
function Post-Action([string]$Name) {
  try { Invoke-Api 'POST' '/api/action' ('{"name":"' + $Name + '"}') | Out-Null; return $true }
  catch { Show-Note 'Connector not reachable' 'The connector is not running. Use "Start connector" in this menu.' 'Warning'; return $false }
}

# ---------- icon ----------
$script:baseBmp = $null
if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
  try { $script:baseBmp = (New-Object System.Drawing.Icon($IconPath, 32, 32)).ToBitmap() } catch {}
}
$script:icons = @{}
function Get-StateIcon([string]$st) {
  if ($script:icons.ContainsKey($st)) { return $script:icons[$st] }
  $bmp = New-Object System.Drawing.Bitmap(32, 32)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  if ($script:baseBmp) { $g.DrawImage($script:baseBmp, 0, 0, 32, 32) }
  else {
    $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(201, 99, 31))), 1, 1, 30, 30)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(236, 232, 225))), 6, 9, 20, 4)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(236, 232, 225))), 6, 19, 20, 4)
  }
  switch ($st) {
    'ok'   { $c = [System.Drawing.Color]::FromArgb(86, 156, 62) }
    'warn' { $c = [System.Drawing.Color]::FromArgb(222, 160, 32) }
    'fail' { $c = [System.Drawing.Color]::FromArgb(196, 58, 46) }
    default { $c = [System.Drawing.Color]::FromArgb(128, 128, 128) }
  }
  $g.FillEllipse((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(36, 36, 36))), 15, 15, 17, 17)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($c)), 17, 17, 13, 13)
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $script:icons[$st] = $icon
  return $icon
}

# ---------- tray icon & menu ----------
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = Get-StateIcon 'idle'
$notify.Text = 'ChatGPT Chrome Connector: starting'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$menu.ShowImageMargin = $false
function Add-Item([string]$Text, [scriptblock]$OnClick) {
  $i = New-Object System.Windows.Forms.ToolStripMenuItem($Text)
  if ($OnClick) { $i.Add_Click($OnClick) }
  [void]$menu.Items.Add($i)
  return $i
}
function Add-Sep { [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) }

$hdr = Add-Item 'ChatGPT Chrome Connector' $null
$hdr.Enabled = $false
$hdr.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
$miStatus = Add-Item 'Status: starting' $null
$miStatus.Enabled = $false
Add-Sep
$miOpen = Add-Item 'Open control panel' { Show-Panel '' }
$miOpen.Font = New-Object System.Drawing.Font($menu.Font, [System.Drawing.FontStyle]::Bold)
$miCopy = Add-Item 'Copy connector URL' {
  if ($script:url) { [System.Windows.Forms.Clipboard]::SetText($script:url); Show-Note 'Copied' 'Connector URL copied. Paste it into ChatGPT.' 'Info' }
}
Add-Sep
$miDiag = Add-Item 'Run diagnostics...' { Show-Panel 'diagnostics' }
$miFix = Add-Item 'Auto-repair connection' { if (Post-Action 'auto-repair') { Show-Note 'Auto-repair' 'Repair started. Results appear in the control panel.' 'Info' } }
$miTunnel = Add-Item 'Restart tunnel' { Post-Action 'restart-tunnel' | Out-Null }
$miExt = Add-Item 'Reconnect Chrome extension' { Post-Action 'repair-pairing' | Out-Null }
Add-Sep
$miStart = Add-Item 'Start connector' { Start-Connector }
$miRestart = Add-Item 'Restart connector' { Post-Action 'restart-server' | Out-Null }
$miStop = Add-Item 'Stop connector and exit' {
  $r = [System.Windows.Forms.MessageBox]::Show('Stop the connector? ChatGPT will lose access to Chrome until you start it again.', 'ChatGPT Chrome Connector', 'OKCancel', 'Warning')
  if ($r -eq 'OK') { try { Invoke-Api 'POST' '/api/action' '{"name":"stop"}' | Out-Null } catch {}; Quit-Tray }
}
$miQuitTray = Add-Item 'Close tray icon' { Quit-Tray }
$miStart.Visible = $false
$miQuitTray.Visible = $false
$notify.ContextMenuStrip = $menu

function Set-Tip([string]$t) { if ($t.Length -gt 63) { $t = $t.Substring(0, 60) + '...' }; $notify.Text = $t }

function Show-Note([string]$Title, [string]$Text, [string]$Level) {
  if (-not $Text) { $Text = ' ' }
  $icon = [System.Windows.Forms.ToolTipIcon]::Info
  if ($Level -eq 'Warning' -or $Level -eq 'warn') { $icon = [System.Windows.Forms.ToolTipIcon]::Warning }
  if ($Level -eq 'Error' -or $Level -eq 'error') { $icon = [System.Windows.Forms.ToolTipIcon]::Error }
  $notify.ShowBalloonTip(6000, $Title, $Text, $icon)
}

function Find-Panel {
  if ($script:hwnd -ne [IntPtr]::Zero -and [CcWin]::IsWindow($script:hwnd)) { return $script:hwnd }
  $script:hwnd = [CcWin]::Find($WindowTitle)
  return $script:hwnd
}
function Show-Panel([string]$View) {
  $h = Find-Panel
  if ($h -ne [IntPtr]::Zero) {
    [void][CcWin]::ShowWindow($h, 5)
    if ([CcWin]::IsIconic($h)) { [void][CcWin]::ShowWindow($h, 9) }
    [void][CcWin]::SetForegroundWindow($h)
    if ($View) { try { Invoke-Api 'POST' '/api/window' ('{"action":"navigate","view":"' + $View + '"}') | Out-Null } catch {} }
    return
  }
  try { Invoke-Api 'POST' '/api/window' ('{"action":"open","force":true,"view":"' + $View + '"}') | Out-Null }
  catch {
    $r = [System.Windows.Forms.MessageBox]::Show('The connector is not running. Start it now?', 'ChatGPT Chrome Connector', 'YesNo', 'Question')
    if ($r -eq 'Yes') { Start-Connector }
  }
}
function Hide-Panel {
  $h = Find-Panel
  if ($h -ne [IntPtr]::Zero) {
    [void][CcWin]::ShowWindow($h, 0)
    if (-not $script:toldAboutTray) {
      $script:toldAboutTray = $true
      Show-Note 'Still running' 'The connector keeps working in the notification area. Click this icon to open the control panel.' 'Info'
    }
  }
}
function Start-Connector {
  if (-not $StartExe) { return }
  try {
    if ($StartArgs -and $StartArgs -ne 'none') { Start-Process -FilePath $StartExe -ArgumentList $StartArgs -WindowStyle Hidden }
    else { Start-Process -FilePath $StartExe }
    Set-Tip 'ChatGPT Chrome Connector: starting'
    $miStatus.Text = 'Status: starting...'
  } catch { Show-Note 'Could not start' $_.Exception.Message 'Error' }
}
function Quit-Tray {
  $script:quitting = $true
  $timer.Stop()
  $notify.Visible = $false
  $notify.Dispose()
  try { $mutex.ReleaseMutex() } catch {}
  if ($appCtx) { $appCtx.ExitThread() }
}

$notify.Add_MouseUp({ param($s, $e) if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Show-Panel '' } })
$notify.Add_BalloonTipClicked({
  if ($script:balloonCopy) { [System.Windows.Forms.Clipboard]::SetText($script:balloonCopy); $script:balloonCopy = $null; Show-Note 'Copied' 'Connector URL copied. Paste it into ChatGPT.' 'Info' }
  else { Show-Panel '' }
})

# ---------- poll loop ----------
function Tick {
  try {
    $r = Invoke-Api 'GET' ('/api/tray/poll?since=' + $script:lastCmd) $null
    $script:fails = 0
    $script:everUp = $true
    $script:url = $r.connectorUrl
    $script:settings = $r.settings
    if ($r.state -ne $script:state) { $script:state = $r.state; $notify.Icon = Get-StateIcon $r.state }
    Set-Tip ('Connector: ' + $r.summary)
    $miStatus.Text = 'Status: ' + $r.summary
    $miCopy.Enabled = [bool]$r.connectorUrl
    $miStart.Visible = $false; $miQuitTray.Visible = $false
    $miRestart.Visible = $true; $miStop.Visible = $true
    $miFix.Enabled = $true; $miTunnel.Enabled = $true; $miExt.Enabled = $true; $miDiag.Enabled = $true
    foreach ($c in $r.commands) {
      if ($c.id -gt $script:lastCmd) { $script:lastCmd = $c.id }
      switch ($c.type) {
        'show' { Show-Panel '' }
        'hide' { Hide-Panel }
        'exit' { Quit-Tray; return }
        'notify' {
          if (-not $r.settings -or $r.settings.notifications) {
            $script:balloonCopy = $c.copy
            Show-Note $c.title $c.text $c.level
          }
        }
      }
    }
    # Native minimize button sends the panel to the tray when that setting is on.
    if ($r.settings -and $r.settings.minimizeToTray) {
      $h = Find-Panel
      if ($h -ne [IntPtr]::Zero -and [CcWin]::IsWindowVisible($h) -and [CcWin]::IsIconic($h)) { Hide-Panel }
    }
  } catch {
    $script:fails++
    if ($script:fails -ge 2 -and $script:state -ne 'down') {
      $script:state = 'down'
      $script:lastCmd = 0
      $notify.Icon = Get-StateIcon 'fail'
      Set-Tip 'ChatGPT Chrome Connector: NOT RUNNING'
      $miStatus.Text = 'Status: connector not running'
      $miCopy.Enabled = $false
      $miFix.Enabled = $false; $miTunnel.Enabled = $false; $miExt.Enabled = $false; $miDiag.Enabled = $false
      $miStart.Visible = [bool]$StartExe; $miQuitTray.Visible = $true
      $miRestart.Visible = $false; $miStop.Visible = $false
      if ($script:everUp) { Show-Note 'Connector stopped' 'ChatGPT can no longer reach Chrome. Right-click this icon and choose "Start connector".' 'Warning' }
    }
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({ Tick })
$timer.Start()

$appCtx = New-Object System.Windows.Forms.ApplicationContext
[System.Windows.Forms.Application]::Run($appCtx)
exit 0
`;
