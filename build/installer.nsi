; ChatGPT Chrome Connector - Windows installer (NSIS 3)
; Per-user install: no administrator rights needed.
Target amd64-unicode  ; the app is x64-only, so the installer is too
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "1.1.0"
!endif
!define APPNAME "ChatGPT Chrome Connector"
!define EXE "ChatGPTChromeConnector.exe"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ChatGPTChromeConnector"

Name "${APPNAME}"
OutFile "..\dist\ChatGPTChromeConnector-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
InstallDirRegKey HKCU "Software\ChatGPTChromeConnector" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
ManifestDPIAware true

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "FileDescription" "${APPNAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "This will install ${APPNAME} ${VERSION}.$\r$\n$\r$\nIt lets the ChatGPT desktop app read and control your Chrome browser through a custom connector.$\r$\n$\r$\nAfter installing, a setup page opens in your browser and walks you through the last two steps: loading the Chrome extension and adding the connector to ChatGPT."
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${APPNAME} and open the setup page"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

!macro StopRunning DIR
  IfFileExists "${DIR}\${EXE}" 0 +3
    nsExec::Exec '"${DIR}\${EXE}" --stop'
    Sleep 800
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  ; Only the cloudflared that lives in our folder, never one the user runs themselves.
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Get-Process cloudflared -ErrorAction SilentlyContinue | Where-Object { $$_.Path -eq '${DIR}\cloudflared.exe' } | Stop-Process -Force"`
  Sleep 300
!macroend

Section "!${APPNAME}" SecMain
  SectionIn RO
  !insertmacro StopRunning "$INSTDIR"
  SetOutPath "$INSTDIR"
  File "out\${EXE}"
  File "vendor\cloudflared.exe"
  File "assets\icon.ico"
  SetOutPath "$INSTDIR\extension"
  File /r /x token.json "..\extension\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\ChatGPTChromeConnector" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${APPNAME}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Stop ${APPNAME}.lnk" "$INSTDIR\${EXE}" "--stop" "$INSTDIR\icon.ico"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Chrome extension folder.lnk" "$INSTDIR\extension"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall.exe"
SectionEnd

Section "Start automatically when I sign in" SecStartup
  CreateShortcut "$SMSTARTUP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "--background" "$INSTDIR\icon.ico"
SectionEnd

Section /o "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\icon.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "The connector app, the secure tunnel (cloudflared) and the Chrome extension."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Run the connector in the background whenever you sign in to Windows, so ChatGPT can always reach Chrome."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "Put a shortcut that opens the connector's setup page on the desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  !insertmacro StopRunning "$INSTDIR"
  Delete "$SMSTARTUP\${APPNAME}.lnk"
  Delete "$DESKTOP\${APPNAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APPNAME}"
  RMDir /r "$INSTDIR\extension"
  Delete "$INSTDIR\${EXE}"
  Delete "$INSTDIR\cloudflared.exe"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  RMDir /r "$LOCALAPPDATA\ChatGPTChromeConnector"
  DeleteRegKey HKCU "${UNINSTKEY}"
  DeleteRegKey HKCU "Software\ChatGPTChromeConnector"
  MessageBox MB_ICONINFORMATION "${APPNAME} was removed.$\r$\n$\r$\nTo finish, remove the extension in Chrome: chrome://extensions → ChatGPT Chrome Connector → Remove. Also delete the connector in ChatGPT's settings."
SectionEnd
