Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
targetPath = ""

For Each file In fso.GetFolder(projectDir).Files
  If LCase(fso.GetExtensionName(file.Name)) = "vbs" Then
    If file.Path <> WScript.ScriptFullName And InStr(file.Name, "AI") > 0 Then
      targetPath = file.Path
      Exit For
    End If
  End If
Next

If targetPath = "" Then
  WScript.Quit 1
End If

assetsDir = fso.BuildPath(projectDir, "assets")
shortcutPath = fso.BuildPath(projectDir, fso.GetBaseName(targetPath) & ".lnk")
iconPath = fso.BuildPath(assetsDir, "app-icon.ico")

Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = targetPath
shortcut.WorkingDirectory = projectDir
shortcut.Description = "AI Chat Hub"
shortcut.IconLocation = iconPath
shortcut.Save
