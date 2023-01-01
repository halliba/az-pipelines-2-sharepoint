param(
    [Parameter(Mandatory=$true)]
    [bool]$Production,
    
    [Parameter(Mandatory=$true)]
    [string]$Version
)

$ErrorActionPreference = "Stop";

$vMajor = $Version.Split('.')[0];
$vMinor = $Version.Split('.')[1];
$vPatch = $Version.Split('.')[2];
$versionOverride = "{""Version"": ""$vMajor.$vMinor.$vPatch""}";

$root = [System.IO.Path]::GetDirectoryName($PSCommandPath);

Set-Location "$root/../buildAndReleaseTask";
$content = Get-Content -Path '.\task.template.json' -Encoding UTF8;
$vars = $null;
if($Production -eq $true) {
    $vars = Get-Content 'task.prod.json' | ConvertFrom-Json;
} else {
    $vars = Get-Content 'task.dev.json' | ConvertFrom-Json;
}

$content = $content `
    -replace '{{id}}', $vars.id `
    -replace '{{name}}', $vars.name `
    -replace '{{friendlyName}}', $vars.friendlyName `
    -replace '{{description}}', $vars.description;

$content = $content `
    -replace '"{{vMajor}}"', $vMajor `
    -replace '"{{vMinor}}"', $vMinor `
    -replace '"{{vPatch}}"', $vPatch;

Write-Host $versionOverride
Set-Content -Path '.\task.json' -Value $content -Encoding UTF8;

Remove-Item './node_modules' -Recurse -Force -ErrorAction SilentlyContinue;
yarn install
yarn build

if($Production -eq $true) {
    tfx extension create --root .. --manifests vss-extension.json --override $versionOverride --output-path ..
} else {
    tfx extension create --root .. --manifests vss-extension.json --override $versionOverride --overrides-file ../vss-extension.dev.json --output-path ..
}
