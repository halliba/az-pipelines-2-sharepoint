param(
    [Parameter(Mandatory=$true)]
    [bool]$Production,

    # Extension version. Every task major gets the same minor and patch, so each release bumps all
    # task versions (agents cache tasks by version). Minor and patch must therefore never go back.
    [Parameter(Mandatory=$true)]
    [string]$Version,

    # Optional publisher override, e.g. to publish a private dev build under your own publisher.
    [Parameter(Mandatory=$false)]
    [string]$Publisher
)

$ErrorActionPreference = "Stop";

if($Version -notmatch '^\d+\.\d+\.\d+$') {
    throw "Version must have the format <major>.<minor>.<patch>, got '$Version'.";
}

$vMajor = $Version.Split('.')[0];
$vMinor = $Version.Split('.')[1];
$vPatch = $Version.Split('.')[2];

$root = [System.IO.Path]::GetFullPath("$([System.IO.Path]::GetDirectoryName($PSCommandPath))/..");
$taskSource = "$root/buildAndReleaseTask";
$staging = "$root/.build";
$taskStaging = "$staging/buildAndReleaseTask";

# yarn and tfx may be installed globally; otherwise fall back to corepack and npx.
function Invoke-Yarn {
    if(Get-Command yarn -ErrorAction SilentlyContinue) { yarn @args } else { corepack yarn @args }
    if($LASTEXITCODE -ne 0) { throw "yarn $args failed." }
}

function Invoke-Tfx {
    if(Get-Command tfx -ErrorAction SilentlyContinue) {
        tfx @args
    } else {
        # npx.ps1 rebuilds its command line from the calling statement and would not see these
        # arguments; the .cmd shim (Windows) or the plain binary receives them as passed.
        $npx = Get-Command 'npx.cmd' -ErrorAction SilentlyContinue;
        if(-not $npx) { $npx = Get-Command 'npx'; }
        & $npx --yes tfx-cli @args
    }
    if($LASTEXITCODE -ne 0) { throw "tfx $args failed." }
}

Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue;
New-Item -ItemType Directory -Path $taskStaging | Out-Null;

# Build once; every task major ships the same compiled code.
Set-Location $taskSource;
Remove-Item './node_modules' -Recurse -Force -ErrorAction SilentlyContinue;
Remove-Item './dist' -Recurse -Force -ErrorAction SilentlyContinue;
Invoke-Yarn install
Invoke-Yarn build

# Install the production dependencies once, without devDependencies.
$prodDeps = "$staging/prod-deps";
New-Item -ItemType Directory -Path $prodDeps | Out-Null;
Copy-Item -Path './package.json', './yarn.lock', './.yarnrc.yml' -Destination $prodDeps;
Push-Location $prodDeps;
Invoke-Yarn workspaces focus --production
Pop-Location;

$vars = $null;
if($Production -eq $true) {
    $vars = Get-Content 'task.prod.json' | ConvertFrom-Json;
} else {
    $vars = Get-Content 'task.dev.json' | ConvertFrom-Json;
}

$template = Get-Content -Path './task.template.json' -Encoding UTF8 -Raw;
$template = $template `
    -replace '{{id}}', $vars.id `
    -replace '{{name}}', $vars.name `
    -replace '{{friendlyName}}', $vars.friendlyName `
    -replace '{{description}}', $vars.description `
    -replace '"{{vMinor}}"', $vMinor `
    -replace '"{{vPatch}}"', $vPatch;

# One folder per task major, e.g. buildAndReleaseTask/v0. Azure DevOps finds the task.json
# one level below the contribution folder and offers every major side by side.
$overlays = @(Get-ChildItem -Path '.' -Filter 'task.v*.json');
if($overlays.Count -eq 0) {
    throw "No task.v<major>.json found in '$taskSource'.";
}

foreach($overlayFile in $overlays) {
    $overlay = Get-Content -Path $overlayFile.FullName -Encoding UTF8 -Raw | ConvertFrom-Json;
    $taskMajor = $overlay.version.Major;

    $task = ($template -replace '"{{vMajor}}"', $taskMajor) | ConvertFrom-Json;

    # Every other top-level property of the overlay (execution, minimumAgentVersion, ...)
    # replaces the one from the template.
    foreach($property in $overlay.PSObject.Properties) {
        if($property.Name -eq 'version') { continue; }
        $task | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force;
    }

    $taskFolder = "$taskStaging/v$taskMajor";
    New-Item -ItemType Directory -Path $taskFolder | Out-Null;
    $task | ConvertTo-Json -Depth 32 | Set-Content -Path "$taskFolder/task.json" -Encoding UTF8;

    Copy-Item -Path './icon.png', './package.json' -Destination $taskFolder;
    Copy-Item -Path './dist' -Destination $taskFolder -Recurse;
    Copy-Item -Path "$prodDeps/node_modules" -Destination $taskFolder -Recurse;

    Write-Host "Task v$($taskMajor): $($task.name) $taskMajor.$vMinor.$vPatch ($(@($task.execution.PSObject.Properties.Name) -join ', '))";
}

Remove-Item $prodDeps -Recurse -Force;

# Extension manifest and the files it references.
Copy-Item -Path "$root/vss-extension.json", "$root/README.md", "$root/LICENSE" -Destination $staging;
New-Item -ItemType Directory -Path "$staging/images" | Out-Null;
Copy-Item -Path "$root/images/icon_128.png" -Destination "$staging/images";

# Version, publisher and the dev settings go to tfx as one overrides file; inline JSON
# arguments do not survive the quoting of every shell and shim.
$overrides = if($Production -eq $true) {
    [pscustomobject]@{}
} else {
    Get-Content "$root/vss-extension.dev.json" -Encoding UTF8 -Raw | ConvertFrom-Json
};
$overrides | Add-Member -NotePropertyName 'version' -NotePropertyValue "$vMajor.$vMinor.$vPatch" -Force;
if($Publisher) {
    $overrides | Add-Member -NotePropertyName 'publisher' -NotePropertyValue $Publisher -Force;
}
$overridesFile = "$staging/vss-extension.overrides.json";
$overrides | ConvertTo-Json -Depth 8 | Set-Content -Path $overridesFile -Encoding UTF8;
Write-Host ($overrides | ConvertTo-Json -Depth 8 -Compress);

Invoke-Tfx extension create --root $staging --manifests vss-extension.json --overrides-file $overridesFile --output-path $root
