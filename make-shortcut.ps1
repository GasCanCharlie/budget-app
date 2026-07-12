$s = New-Object -ComObject WScript.Shell
$lnk = $s.CreateShortcut("$env:USERPROFILE\Desktop\Claude BudgetLens.lnk")
$lnk.TargetPath = "C:\Windows\System32\cmd.exe"
$lnk.Arguments = '/k "cd /d C:\Users\dachn\budget-app && title Claude Code Terminal && claude --resume budget-app 2>nul || claude -n budget-app"'
$lnk.WorkingDirectory = "C:\Users\dachn\budget-app"
$lnk.Save()
Write-Host "Shortcut created on Desktop."
