; ChatGPT Chrome Connector - Windows installer (Inno Setup 6), used by build-windows.ps1.
; Per-user install: no administrator rights needed. Mirrors installer.nsi (the Linux/Wine build).
#define AppName "ChatGPT Chrome Connector"
#ifndef Version
  #define Version "1.2.0"
#endif
#define Exe "ChatGPTChromeConnector.exe"

[Setup]
AppId={{8C3E6D1A-5B7F-4E2A-9C41-7D2B6E0F1A93}
AppName={#AppName}
AppVersion={#Version}
AppVerName={#AppName} {#Version}
AppPublisher={#AppName}
VersionInfoVersion={#Version}
VersionInfoDescription={#AppName} Setup
DefaultDirName={localappdata}\Programs\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ChatGPTChromeConnector-Setup-{#Version}
SetupIconFile=assets\icon.ico
UninstallDisplayIcon={app}\icon.ico
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
CloseApplications=no
RestartApplications=no

[Messages]
WelcomeLabel2=This will install [name/ver].%n%nIt lets the ChatGPT desktop app read and control your Chrome browser through a custom connector.%n%nAfter installing, the control panel opens and walks you through the last steps: loading the Chrome extension and adding the connector to ChatGPT. It also lives in the notification area next to the clock.

[Tasks]
Name: startup; Description: "Start automatically when I sign in (runs quietly in the notification area)"
Name: desktopicon; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "out\{#Exe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "vendor\cloudflared.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "assets\icon.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\extension\*"; DestDir: "{app}\extension"; Excludes: "token.json"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{userprograms}\{#AppName}\{#AppName}"; Filename: "{app}\{#Exe}"; IconFilename: "{app}\icon.ico"; Comment: "Open the connector control panel"
Name: "{userprograms}\{#AppName}\Stop {#AppName}"; Filename: "{app}\{#Exe}"; Parameters: "--stop"; IconFilename: "{app}\icon.ico"
Name: "{userprograms}\{#AppName}\Chrome extension folder"; Filename: "{app}\extension"
Name: "{userprograms}\{#AppName}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userstartup}\{#AppName}"; Filename: "{app}\{#Exe}"; Parameters: "--background"; IconFilename: "{app}\icon.ico"; Tasks: startup
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#Exe}"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#Exe}"; Description: "Start {#AppName} and open the control panel"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\extension\token.json"
Type: dirifempty; Name: "{app}\extension"
Type: filesandordirs; Name: "{localappdata}\ChatGPTChromeConnector"

[Code]
procedure StopRunning(Dir: String);
var
  Rc: Integer;
begin
  { --stop shuts the connector down gracefully, then sweeps up its window, tray icon and tunnels. }
  if FileExists(Dir + '\{#Exe}') then
    Exec(Dir + '\{#Exe}', '--stop', '', SW_HIDE, ewWaitUntilTerminated, Rc);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#Exe}', '', SW_HIDE, ewWaitUntilTerminated, Rc);
  Sleep(500);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunning(ExpandConstant('{app}'));
  Result := '';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    StopRunning(ExpandConstant('{app}'));
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then
    MsgBox('{#AppName} was removed.' + #13#10#13#10 +
      'To finish, remove the extension in Chrome: chrome://extensions, then ChatGPT Chrome Connector, then Remove. Also delete the connector in ChatGPT''s settings.',
      mbInformation, MB_OK);
end;
