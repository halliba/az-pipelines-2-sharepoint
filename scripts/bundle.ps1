param(
    [Parameter(Mandatory=$true)]
    [bool]$Production
)

$ErrorActionPreference = "Stop";

$root = [System.IO.Path]::GetDirectoryName($PSCommandPath);

Set-Location "$root/../buildAndReleaseTask";
if($Production -eq $true) {
    Copy-Item './task.prod.json' './task.json';
} else {
    Copy-Item './task.dev.json' './task.json';
}

Remove-Item './node_modules' -Recurse -Force;
yarn install
yarn build

if($Production -eq $true) {
    tfx extension create --root .. --manifests vss-extension.json --output-path ..
} else {
    tfx extension create --root .. --manifests vss-extension.json --overrides-file ../vss-extension.dev.json --output-path ..
}
