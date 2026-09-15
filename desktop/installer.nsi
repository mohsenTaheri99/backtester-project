; Gold Backtester setup file.
; Built by scripts/build.mjs, which passes:
;   /DVERSION=x.y.z  /DSRC=<PyInstaller app folder>  /DOUTFILE=<setup exe path>

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APP_NAME "Gold Backtester"
!define APP_EXE "GoldBacktester.exe"
!define APP_ID "GoldBacktester"
!define PUBLISHER "mohsen taheri"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
; Microsoft Edge WebView2 Runtime client id (same for every WebView2 install).
!define WEBVIEW2_GUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_URL "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\${APP_ID}" "InstallDir"
RequestExecutionLevel user ; per-user install, no admin prompt
SetCompressor /SOLID lzma
SetCompressorDictSize 64
ManifestDPIAware true

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "Copyright (c) 2026 ${PUBLISHER}"

!define MUI_ICON "assets\icon.ico"
!define MUI_UNICON "assets\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; The app window runs on WebView2. It ships with Windows 11 and most Windows 10
  ; PCs; warn (but allow continuing) when it is missing.
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_GUID}" "pv"
  StrCmp $0 "" 0 +2
  ReadRegStr $0 HKCU "Software\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_GUID}" "pv"
  StrCmp $0 "" missing
  StrCmp $0 "0.0.0.0" missing done
  missing:
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "${APP_NAME} needs the Microsoft Edge WebView2 Runtime, which was not found on this PC.$\r$\n$\r$\nOpen the Microsoft download page now? (Install it, then run this setup again.)" \
      IDNO done
    ExecShell "open" "${WEBVIEW2_URL}"
    Abort
  done:
FunctionEnd

Section "Install"
  ; Close a running copy so its files can be replaced.
  nsExec::Exec 'taskkill /IM "${APP_EXE}" /F'

  SetOutPath "$INSTDIR"
  RMDir /r "$INSTDIR\_internal" ; drop files from an older version
  File /r "${SRC}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\${APP_ID}" "InstallDir" "$INSTDIR"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /IM "${APP_EXE}" /F'

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$INSTDIR"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${APP_ID}"
  ; User data (saved drawings, logs) in %LOCALAPPDATA%\GoldBacktester is kept.
SectionEnd
