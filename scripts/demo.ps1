# MacroBuddy demo script: appends a timestamped line to a log in the OS temp dir.
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') hello from MacroBuddy args=$($args -join ' ')"
$out = Join-Path ([IO.Path]::GetTempPath()) 'macrobuddy-demo.log'
Add-Content -Path $out -Value $line
Write-Output "$line -> $out"
