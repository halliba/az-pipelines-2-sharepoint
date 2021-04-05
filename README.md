# az-pipelines-2-sharepoint

![Logo](./images/icon_128.png)

![Version](https://img.shields.io/visual-studio-marketplace/v/halliba.az-pipelines-2-sharepoint?label=Visual%20Studio%20Marketplace&style=flat-square)

**az-pipelines-2-sharepoint** is an Azure DevOps extensions to upload file or build artefacts to a SharePoint Online library via Microsoft Graph.

*This extension can not be used with on-premise SharePoint installations.*

## Installation
**Azure Pipelines:** Visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=halliba.az-pipelines-2-sharepoint) and click *install*. Choose your Azure DevOps organization.

**Azure DevOps Server**: Visit the [Marketplace page](https://marketplace.visualstudio.com/items?itemName=halliba.az-pipelines-2-sharepoint) and click *install*. Then choose *Download* and install it via the Extension page on your local Azure DevOps Server.

## Usage
1. Register a new application in your Azure AD tenant:
    - Choose any name.
    - Supported Account types: *Accounts in this organizational directory only.*
    - No Redirect URL is needed.
    - Add a client secret as authentication method.
    - Add the API permissions: `Microsoft Graph` -> `Application permissions` -> `Files` -> `Files.ReadWrite.All`  
    (AFAIK you can not use a Service Principal to grant access to a single Drive only. If you know how to, please let me know.)
2. Find your target drive ID: https://docs.microsoft.com/en-us/graph/api/drive-get
3. Add a new `Upload files to SharePoint Online` task to your build pipeline.
4. Fill in all required parameters.

## Known Issues
- Due to a limitation of the Microsoft Graph File endpoint you can not upload files with 0-byte size. Those files will be skipped and a warning message is shown.
- AFAIK you can not use a Service Principal to grant access to a single Drive only. If you know how to, please let me know.  
**The registered app has access to all SharePoint drives - if this is a problem, you should not use this extension!**
