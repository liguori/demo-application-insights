targetScope = 'resourceGroup'

param environmentName string
param location string

var resourceToken = uniqueString(subscription().subscriptionId, resourceGroup().id)
var tags = {
  'azd-env-name': environmentName
}

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${resourceToken}'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${resourceToken}'
  location: location
  kind: 'web'
  tags: tags
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    IngestionMode: 'LogAnalytics'
    DisableLocalAuth: false
    DisableIpMasking: false
    SamplingPercentage: 100
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-${resourceToken}'
  location: location
  kind: 'linux'
  tags: tags
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2024-04-01' = {
  name: 'app-${resourceToken}'
  location: location
  kind: 'app,linux'
  tags: union(tags, {
    'azd-service-name': 'web'
  })
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/health'
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsights.properties.ConnectionString
        }
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
        {
          name: 'Demo__EnableFailure'
          value: 'true'
        }
        {
          // The application owns SDK instrumentation; do not also inject the App Service agent.
          name: 'ApplicationInsightsAgent_EXTENSION_VERSION'
          value: 'disabled'
        }
        {
          // azd deploys dotnet publish output, including the built SPA, rather than source.
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'false'
        }
      ]
    }
  }
}

output webAppName string = webApp.name
output webEndpoint string = 'https://${webApp.properties.defaultHostName}'
output applicationInsightsName string = applicationInsights.name
output workspaceName string = workspace.name
output workspaceId string = workspace.properties.customerId
output workspaceResourceId string = workspace.id

// Safe to expose to the browser; this grants ingestion, not query access.
#disable-next-line outputs-should-not-contain-secrets
output applicationInsightsConnectionString string = applicationInsights.properties.ConnectionString
