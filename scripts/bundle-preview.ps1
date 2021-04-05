$ErrorActionPreference = "Stop";
$previousLocation = Get-Location;
Set-Location '../buildAndReleaseTask';
Copy-Item './task.preview.json' './task.json';
npm run build
tfx extension create --root .. --manifests vss-extension.json --overrides-file ../vss-extension.preview.json --output-path ..
Set-Location $previousLocation;
