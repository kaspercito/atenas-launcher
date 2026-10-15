; Instalador personalizado de Atenas Launcher (electron-builder incluye este archivo automáticamente)
!macro customHeader
  BrandingText "Atenas Launcher  ·  por kaspercito"
  !ifndef MUI_WELCOMEPAGE_TITLE
    !define MUI_WELCOMEPAGE_TITLE "Bienvenido a Atenas Launcher"
  !endif
  !ifndef MUI_WELCOMEPAGE_TEXT
    !define MUI_WELCOMEPAGE_TEXT "Este asistente instalará Atenas Launcher en tu equipo.$\r$\n$\r$\nIncluye modpacks que se instalan y actualizan solos, estado del servidor, amigos y Discord Rich Presence.$\r$\n$\r$\nHaz clic en Siguiente para continuar."
  !endif
  !ifndef MUI_FINISHPAGE_TITLE
    !define MUI_FINISHPAGE_TITLE "Todo listo"
  !endif
  !ifndef MUI_FINISHPAGE_TEXT
    !define MUI_FINISHPAGE_TEXT "Atenas Launcher se instaló correctamente.$\r$\n$\r$\nLa primera vez que juegues descargará Java y los mods del modpack automáticamente."
  !endif
  !ifndef MUI_FINISHPAGE_LINK
    !define MUI_FINISHPAGE_LINK "Página del proyecto en GitHub"
    !define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/kaspercito/atenas-launcher"
  !endif
!macroend

; Al desinstalar (a mano) pregunta si borrar también modpacks, mundos y ajustes. En silencio (actualizaciones) NO borra nada.
!macro customUnInstall
  MessageBox MB_YESNO|MB_ICONQUESTION "¿Quieres borrar también tus modpacks, mundos y ajustes de Atenas Launcher?$\r$\n$\r$\nElige No para conservarlos." /SD IDNO IDNO +2
  RMDir /r "$APPDATA\${APP_FILENAME}"
!macroend
