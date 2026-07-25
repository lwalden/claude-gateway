' Headless autostart wrapper, mirrors highest-level-project-management's
' dispatch-watcher-hidden.vbs pattern.
'
' Scheduled Task invokes this VBS via wscript.exe, which has no console.
' The VBS then launches powershell.exe with SW_HIDE (the "0" argument to
' Run), producing a fully headless invocation chain -- no console window,
' no focus steal, even under LogonType Interactive.
'
' Invoked as:  wscript.exe //nologo start-gateway-hidden.vbs

Option Explicit

Dim oShell, oFSO, sScriptDir, sLauncher, sCmd

Set oShell = CreateObject("WScript.Shell")
Set oFSO = CreateObject("Scripting.FileSystemObject")
sScriptDir = oFSO.GetParentFolderName(WScript.ScriptFullName)
sLauncher = sScriptDir & "\start-gateway.ps1"

sCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & sLauncher & """"

' Run(command, windowStyle, waitForCompletion)
'   windowStyle 0 = SW_HIDE
'   waitForCompletion False = fire-and-forget; wscript exits immediately.
'   The gateway keeps running under the spawned (hidden) powershell.exe
'   for as long as node stays up -- this is a persistent server, not a
'   one-shot task, so it is deliberately not awaited.
oShell.Run sCmd, 0, False
