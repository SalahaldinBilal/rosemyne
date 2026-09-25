; Updates run the old uninstaller too, and must keep the context menu entries.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --unregister-context-menu'
  ${EndIf}
!macroend
