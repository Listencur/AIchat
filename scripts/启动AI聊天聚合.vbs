Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDir = fso.GetParentFolderName(scriptDir)
launcherPath = fso.BuildPath(projectDir, "AiChat.exe")

shell.CurrentDirectory = projectDir

If fso.FileExists(launcherPath) Then
  shell.Run Chr(34) & launcherPath & Chr(34), 0, False
Else
  shell.Run "cmd.exe /d /c npm start", 0, False
End If
