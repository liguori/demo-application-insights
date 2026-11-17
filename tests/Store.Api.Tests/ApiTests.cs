using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Diagnostics;
using System.Collections.Concurrent;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Store.Api;

namespace Store.Api.Tests;

public sealed class StoreFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
        builder.UseSetting("APPLICATIONINSIGHTS_CONNECTION_STRING", "")
            .UseSetting("Demo:EnableFailure", "true");
}

public sealed class ApiTests(StoreFactory factory) : IClassFixture<StoreFactory>
{
    private readonly HttpClient client = factory.CreateClient();

    [Fact]
    public async Task CatalogIsSeededAndDetailMatches()
    {
        var products = await client.GetFromJsonAsync<Product[]>("/api/products");
        Assert.NotNull(products);
        Assert.Equal(6, products.Length);
        Assert.All(products, product => Assert.True(product.Price > 0));
        var detail = await client.GetFromJsonAsync<Product>("/api/products/1");
        Assert.Equal(products[0], detail);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/products/999")).StatusCode);
    }

    [Fact]
    public async Task ConfigIsRuntimeAndNotCached()
    {
        var response = await client.GetAsync("/api/config");
        var config = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.False(config.GetProperty("telemetryEnabled").GetBoolean());
        Assert.Equal("", config.GetProperty("applicationInsightsConnectionString").GetString());
        Assert.True(config.GetProperty("demoFailureEnabled").GetBoolean());
        Assert.True(response.Headers.CacheControl?.NoStore);
    }

    [Fact]
    public async Task CheckoutPricesOnServerAndPersistsInMemory()
    {
        var journey = Guid.NewGuid().ToString();
        var response = await client.PostAsJsonAsync("/api/orders", new
        {
            items = new[] { new { productId = 1, quantity = 2, unitPrice = 0.01 } },
            journeyId = journey,
            total = 0.02
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var order = await response.Content.ReadFromJsonAsync<Order>();
        Assert.NotNull(order);
        Assert.Equal(179.80m, order.Total);
        Assert.Equal(journey, order.JourneyId);
        Assert.Equal(89.90m, Assert.Single(order.Items).UnitPrice);
        var stored = await client.GetFromJsonAsync<Order>(response.Headers.Location);
        Assert.NotNull(stored);
        Assert.Equal(order.Id, stored.Id);
        Assert.Single(stored.Items);
    }

    [Theory]
    [InlineData("""{"items":[],"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":null,"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":[null],"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":[{"productId":1,"quantity":0}],"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":[{"productId":1,"quantity":21}],"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":[{"productId":999,"quantity":1}],"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":[{"productId":1,"quantity":1},{"productId":1,"quantity":1}],"journeyId":"00000000-0000-0000-0000-000000000001"}""")]
    [InlineData("""{"items":[{"productId":1,"quantity":1}],"journeyId":"invalid"}""")]
    public async Task InvalidCheckoutReturnsProblem(string json)
    {
        var response = await client.PostAsync("/api/orders", new StringContent(json, System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var problem = await response.Content.ReadFromJsonAsync<JsonElement>();
        Assert.True(problem.TryGetProperty("traceId", out _));
    }

    [Fact]
    public async Task DemoFailureIsSanitizedAndRetainsW3CTraceId()
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/demo/failure");
        request.Headers.Add("traceparent", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01");
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.InternalServerError, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("InvalidOperationException", json);
        Assert.DoesNotContain("StackTrace", json);
        var problem = JsonSerializer.Deserialize<JsonElement>(json);
        Assert.Equal("0123456789abcdef0123456789abcdef", problem.GetProperty("traceId").GetString());
    }

    [Fact]
    public async Task UnknownApiIsNotSpaHtml()
    {
        var response = await client.GetAsync("/api/unknown");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task CheckoutEmitsCorrelatedSpanWithJourney()
    {
        var stopped = new ConcurrentBag<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == StoreTelemetry.ServiceName,
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = stopped.Add
        };
        ActivitySource.AddActivityListener(listener);
        var journey = Guid.NewGuid().ToString();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/orders");
        request.Headers.Add("traceparent", "00-abcdef0123456789abcdef0123456789-abcdef0123456789-01");
        request.Headers.Add("X-Demo-Journey", journey);
        request.Content = JsonContent.Create(new { items = new[] { new { productId = 1, quantity = 1 } }, journeyId = journey });
        var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var span = Assert.Single(stopped, span => span.GetTagItem("journeyId")?.ToString() == journey);
        Assert.Equal("store.create_order", span.DisplayName);
        Assert.Equal("abcdef0123456789abcdef0123456789", span.TraceId.ToString());
        Assert.NotNull(span.GetTagItem("order.id"));
    }

    [Fact]
    public async Task DemoFailureCanBeDisabled()
    {
        using var disabledFactory = factory.WithWebHostBuilder(builder => builder.UseSetting("Demo:EnableFailure", "false"));
        using var disabledClient = disabledFactory.CreateClient();
        var response = await disabledClient.GetAsync("/api/demo/failure");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task DemoRateLimitRejectsTheSixtyFirstWrite()
    {
        using var limitedFactory = factory.WithWebHostBuilder(_ => { });
        using var limitedClient = limitedFactory.CreateClient();
        var body = new { items = new[] { new { productId = 1, quantity = 1 } }, journeyId = Guid.NewGuid().ToString() };
        for (var i = 0; i < 60; i++)
        {
            var allowed = await limitedClient.PostAsJsonAsync("/api/orders", body);
            Assert.Equal(HttpStatusCode.Created, allowed.StatusCode);
        }
        var rejected = await limitedClient.PostAsJsonAsync("/api/orders", body);
        Assert.Equal(HttpStatusCode.TooManyRequests, rejected.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(60), rejected.Headers.RetryAfter?.Delta);
        Assert.Equal("application/problem+json", rejected.Content.Headers.ContentType?.MediaType);
    }
}
