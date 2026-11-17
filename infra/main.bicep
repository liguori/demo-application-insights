targetScope = 'subscription'

@description('The azd environment name, used for the new resource group and resource tags.')
@minLength(1)
@maxLength(64)
param environmentName string

@description('Azure region shared by all resources.')
param location string

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: {
    'azd-env-name': environmentName
  }
}

module resources './resources.bicep' = {
  name: 'store-resources'
  scope: resourceGroup
  params: {
    environmentName: environmentName
    location: location
  }
}

output AZURE_LOCATION string = location
output AZURE_RESOURCE_GROUP string = resourceGroup.name
output SERVICE_WEB_NAME string = resources.outputs.webAppName
output SERVICE_WEB_ENDPOINT string = resources.outputs.webEndpoint
output APPLICATIONINSIGHTS_NAME string = resources.outputs.applicationInsightsName
output LOG_ANALYTICS_WORKSPACE_NAME string = resources.outputs.workspaceName
output LOG_ANALYTICS_WORKSPACE_ID string = resources.outputs.workspaceId
output LOG_ANALYTICS_WORKSPACE_RESOURCE_ID string = resources.outputs.workspaceResourceId

// This is a public ingestion identifier used by the browser SDK, not a secret credential.
#disable-next-line outputs-should-not-contain-secrets
output APPINSIGHTS_CONNECTION_STRING string = resources.outputs.applicationInsightsConnectionString
