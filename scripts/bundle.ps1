$ErrorActionPreference = "Stop";
$previousLocation = Get-Location;
Set-Location '../buildAndReleaseTask';
Copy-Item '../buildAndReleaseTask/task.prod.json' '../buildAndReleaseTask/task.json';
npm run build
tfx extension create --root .. --manifests vss-extension.json --output-path ..
Set-Location $previousLocation;
