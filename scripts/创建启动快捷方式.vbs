Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
targetPath = fso.BuildPath(projectDir, "AiChat.exe")
shortcutPath = fso.BuildPath(projectDir, "AiChat.lnk")
iconPath = fso.BuildPath(fso.BuildPath(projectDir, "assets"), "app-icon.ico")

If Not fso.FileExists(targetPath) Then
  WScript.Echo "AiChat.exe does not exist. Please run scripts\build-launcher.ps1 first."
  WScript.Quit 1
End If

Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = targetPath
shortcut.WorkingDirectory = projectDir
shortcut.Description = "AI Chat Hub"
shortcut.IconLocation = iconPath
shortcut.Save
