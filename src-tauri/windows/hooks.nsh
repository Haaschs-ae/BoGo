; Installateur Windows de BoGo : la lecture de l'écran (bogo-vision.exe) peut encore tourner
; (ancienne version, BoGo fermé brutalement) ; on l'arrête avant de remplacer ou supprimer ses
; fichiers, sinon l'installation échoue sur « Erreur lors de l'ouverture du fichier en écriture ».

!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /IM bogo-vision.exe'
  Pop $0
  Sleep 500
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'taskkill /F /IM bogo-vision.exe'
  Pop $0
  Sleep 500
!macroend
