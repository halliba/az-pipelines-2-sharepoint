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
- For **testing** or small environments, add the API permissions: `Microsoft Graph` -> `Application permissions` -> `Files` -> `Files.ReadWrite.All` (The extension will have full access to all SharePoint drives!)
- For **production** environments, add the API permissiones: `Microsoft Graph` -> `Application permissions` -> `Sites` -> `Sites.Selected`.  
    Refer to these blog posts, on how to grant the extension access to the required sites.  
    [Use Sites.Selected Permission with FullControl rather than Write or Read
](https://www.leonarmston.com/2022/02/use-sites-selected-permission-with-fullcontrol-rather-than-write-or-read/)  
[Testing out the new Microsoft Graph SharePoint (specific site collection) app permissions with PnP PowerShell
](https://www.leonarmston.com/2021/03/testing-out-the-new-microsoft-graph-sharepoint-specific-site-collection-app-permissions-with-pnp-powershell/)

## Setup Azure DevOps
1. Find your target drive ID: https://docs.microsoft.com/en-us/graph/api/drive-get
2. Add a new `Upload files to SharePoint Online` task to your build pipeline.
3. Fill in all required parameters.

## Known Issues
- Due to a limitation (or bug?) of the Microsoft Graph File endpoint you can not upload files with 0-byte size. Those files will be skipped and a warning message is shown.
