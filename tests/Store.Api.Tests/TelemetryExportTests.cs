using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using Azure.Monitor.OpenTelemetry.AspNetCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace Store.Api.Tests;

public sealed class TelemetryExportTests
{
    [Fact]
    public async Task AzureMonitorExportsRequestsEventsAndExceptionsToLocalCollector()
    {
        using var portReservation = new TcpListener(IPAddress.Loopback, 0);
        portReservation.Start();
        var port = ((IPEndPoint)portReservation.LocalEndpoint).Port;
        portReservation.Stop();
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        using var stop = new CancellationTokenSource();
        var envelopes = new ConcurrentBag<JsonElement>();
        var collector = CollectAsync(listener, envelopes, stop.Token);
        var journey = Guid.NewGuid().ToString();
        try
        {
            using (var factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            {
                builder.UseSetting("Demo:EnableFailure", "true");
                builder.UseSetting("APPLICATIONINSIGHTS_CONNECTION_STRING",
                    $"InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=http://127.0.0.1:{port}/");
                builder.ConfigureServices(services =>
                    services.Configure<AzureMonitorOptions>(options => options.EnableLiveMetrics = false));
            }))
            {
                using var client = factory.CreateClient();
                client.DefaultRequestHeaders.Add("X-Demo-Journey", journey);
                client.DefaultRequestHeaders.Add("traceparent", "00-123456789abcdef0123456789abcdef0-123456789abcdef0-01");
                var order = await client.PostAsJsonAsync("/api/orders", new
                {
                    items = new[] { new { productId = 1, quantity = 1 } },
                    journeyId = journey
                });
                Assert.Equal(HttpStatusCode.Created, order.StatusCode);
                Assert.Equal(HttpStatusCode.InternalServerError, (await client.GetAsync("/api/demo/failure")).StatusCode);
            }
            await Task.Delay(200);
            Assert.Contains(envelopes, item => BaseType(item) == "RequestData");
            Assert.Contains(envelopes, item => BaseType(item) == "ExceptionData");
            Assert.Contains(envelopes, item =>
                BaseType(item) == "RequestData" &&
                item.GetProperty("data").GetProperty("baseData").GetProperty("properties")
                    .TryGetProperty("journeyId", out var property) && property.GetString() == journey);
            Assert.Contains(envelopes, item =>
                BaseType(item) == "MetricData" &&
                item.GetProperty("data").GetProperty("baseData").GetProperty("metrics")
                    .EnumerateArray().Any(metric => metric.GetProperty("name").GetString() == "store.orders"));
            var customEvent = Assert.Single(envelopes, item =>
                BaseType(item) == "EventData" &&
                item.GetProperty("data").GetProperty("baseData").GetProperty("name").GetString() == "OrderPlaced" &&
                item.GetProperty("data").GetProperty("baseData").GetProperty("properties").GetProperty("journeyId").GetString() == journey);
            Assert.Equal("app-market-api", customEvent.GetProperty("tags").GetProperty("ai.cloud.role").GetString());
            Assert.Equal("123456789abcdef0123456789abcdef0", customEvent.GetProperty("tags").GetProperty("ai.operation.id").GetString());
            Assert.Equal("89.90", customEvent.GetProperty("data").GetProperty("baseData").GetProperty("properties").GetProperty("total").GetString());
            Assert.Contains(envelopes, item =>
                BaseType(item) == "RemoteDependencyData" &&
                item.GetProperty("data").GetProperty("baseData").GetProperty("name").GetString() == "store.create_order");
        }
        finally
        {
            stop.Cancel();
            listener.Stop();
            await collector;
        }
    }

    private static string? BaseType(JsonElement item) =>
        item.TryGetProperty("data", out var data) && data.TryGetProperty("baseType", out var type) ? type.GetString() : null;

    private static async Task CollectAsync(HttpListener listener, ConcurrentBag<JsonElement> envelopes, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await listener.GetContextAsync();
            }
            catch (HttpListenerException) when (stop.IsCancellationRequested)
            {
                break;
            }
            catch (ObjectDisposedException) when (stop.IsCancellationRequested)
            {
                break;
            }
            using var gzip = context.Request.Headers["Content-Encoding"] == "gzip"
                ? new GZipStream(context.Request.InputStream, CompressionMode.Decompress) : null;
            using var reader = new StreamReader(gzip ?? context.Request.InputStream);
            var body = await reader.ReadToEndAsync(stop);
            var count = 0;
            foreach (var line in body.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                using var document = JsonDocument.Parse(line);
                if (document.RootElement.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in document.RootElement.EnumerateArray())
                    {
                        envelopes.Add(item.Clone());
                        count++;
                    }
                }
                else
                {
                    envelopes.Add(document.RootElement.Clone());
                    count++;
                }
            }
            var response = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { itemsReceived = count, itemsAccepted = count, errors = Array.Empty<object>() }));
            context.Response.ContentType = "application/json";
            context.Response.ContentLength64 = response.Length;
            await context.Response.OutputStream.WriteAsync(response, stop);
            context.Response.Close();
        }
    }
}
