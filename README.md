# az-pipelines-2-sharepoint

![Logo](./images/icon_128.png)

[![Version](https://img.shields.io/visual-studio-marketplace/v/halliba.az-pipelines-2-sharepoint?label=Visual%20Studio%20Marketplace&style=flat-square)](https://marketplace.visualstudio.com/items?itemName=halliba.az-pipelines-2-sharepoint)

**az-pipelines-2-sharepoint** is an Azure DevOps extensions to upload file or build artefacts to a SharePoint Online library via Microsoft Graph.

*This extension can not be used with on-premise SharePoint installations.*

## Installation
**Azure Pipelines:** Visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=halliba.az-pipelines-2-sharepoint) and click *install*. Choose your Azure DevOps organization.

**Azure DevOps Server**: Visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=halliba.az-pipelines-2-sharepoint) and click *install*. Then choose *Download* and install it via the Extension page on your local Azure DevOps Server.

## App registration in Azure AD
Register a new application in your Azure AD tenant: (For more info, refer to the [Microsoft Docs](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app))
- Choose any name.
- Supported Account types: *Accounts in this organizational directory only.*
- No Redirect URL is needed.
- Add a client secret as authentication method.
- For **testing** or small environments, add the API permissions: `Microsoft Graph` -> `Application permissions` -> `Files` -> `Files.ReadWrite.All` (The extension will have **full access** to all SharePoint drives!)
- For **production** environments, add the API permissiones: `Microsoft Graph` -> `Application permissions` -> `Sites` -> `Sites.Selected`.  
    Refer to these blog posts, on how to grant the extension access to the required sites.  
    [Use Sites.Selected Permission with FullControl rather than Write or Read
](https://www.leonarmston.com/2022/02/use-sites-selected-permission-with-fullcontrol-rather-than-write-or-read/)  
[Testing out the new Microsoft Graph SharePoint (specific site collection) app permissions with PnP PowerShell
](https://www.leonarmston.com/2021/03/testing-out-the-new-microsoft-graph-sharepoint-specific-site-collection-app-permissions-with-pnp-powershell/)

## Setup Azure DevOps
1. Find your target drive ID: 
2. Add a new `Upload files to SharePoint Online` task to your build pipeline.
3. Fill in all required parameters.

## Parameters

**General**

- **driveId**: SharePoint Online drive ID or URL  
*(required)*  
This parameter can hold one of 2 values:
  - A drive ID from Microsoft Graph. [see Microsoft Docs](https://docs.microsoft.com/en-us/graph/api/drive-get)
  - The full URL to a SharePoint Online Document Library, e.g.:  
    `https://contoso.sharepoint.com/sites/some-project/Shared%20Documents`
- **targetFolder**: Target folder  
*(optional, default=none)*  
This is the target folder relative to the target drive. To copy files to the root of the target drive, leave this parameter empty. You can also use variables here, e.g.:  
`/build-files/$(Build.BuildID)`
- **sourceFolder**: Source folder  
*(optional, default=none)*  
The source folder where the task is executed. This acts as a root directory for the `contents` parameter. Leave this parameter empty to use the current working directory of the pipeline.
- **contents**: Contents to be copied    
*(required)*  
Use this parameter to specifiy which files should be uploaded.  
`**` will upload all files recursively.  
`build-files/**/*.txt` will copy only txt-files recursively unter `build-files` 

#### **Authentication**
These parameters can be found at the application registration page in Azure AD. [Microsoft Docs](https://docs.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)
- **tenantId**: AzureAD tenant ID  
*(required)*
- **clientId**: AzureAD client ID  
*(required)*
- **clientSecret**: AzureAD client secret  
*(required)*

#### **Advanced**
- **conflictBehaviour**: File conflict behaviour  
*(optional, default: fail)*  
Specifies how the task should handle a file where the target file already exists. There are 3 different options:  
`Fail`, `Replace`, `Rename`  
For more info see this [docs article](https://docs.microsoft.com/en-us/graph/api/resources/driveitem?view=graph-rest-1.0#instance-attributes).

- **cleanTargetFolder**: Clean Target folder  
*(optional, default: false)*  
If set to true, the task will delete all files from the target folder.

- **flattenFolders**: Flatten Folders  
*(optional, default: false)*  
If set to true, all files will be copied to the target folder without retaining the source folder structure.


- **failOnEmptySource**: Fail if no files found to copy  
*(optional, default: false)*  
If set to true, the task will fail if no matching files are found under the source folder.

## Sample YAML config file
```yaml
steps:
- task: halliba.az-pipelines-2-sharepoint.az-pipelines-2-sharepoint.az-pipelines-2-sharepoint@0
  displayName: 'Upload files to SharePoint'
  inputs:
    tenantId: 'CCCCCCCC-2222-4444-6666-333333333333'
    clientId: 'AAAAAAAA-1111-3333-5555-FFFFFFFFFFFF'
    clientSecret: '1234567890abcdefghijABCDEFGHIJ1234567890'
    driveId: 'https://contoso.sharepoint.com/sites/some-project/Shared%20Documents'
    targetFolder: '/build-files/$(Build.BuildId)/'
    source: '$(Build.ArtifactStagingDirectory)'
    contents: '/bin/**/*.dll'
```

## Known Issues
- Due to a limitation (or bug?) of the Microsoft Graph File endpoint you can not upload files with 0-byte size. Those files will be skipped and a warning message is shown.
