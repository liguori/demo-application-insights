using System.Diagnostics;
using System.Globalization;
using System.Threading.RateLimiting;
using Azure.Monitor.OpenTelemetry.AspNetCore;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;
using OpenTelemetry.Metrics;
using OpenTelemetry.Logs;
using Store.Api;

var builder = WebApplication.CreateBuilder(args);
var connectionString = builder.Configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"];
var telemetryEnabled = !string.IsNullOrWhiteSpace(connectionString);
var demoFailureEnabled = builder.Configuration.GetValue<bool>("Demo:EnableFailure");

builder.Services.AddSingleton<InMemoryDatabaseRoot>();
builder.Services.AddDbContext<StoreDb>((services, options) =>
    options.UseInMemoryDatabase("AppMarket", services.GetRequiredService<InMemoryDatabaseRoot>()));
builder.Services.AddProblemDetails(options =>
{
    options.CustomizeProblemDetails = context =>
        context.ProblemDetails.Extensions["traceId"] = Activity.Current?.TraceId.ToString() ?? context.HttpContext.TraceIdentifier;
});
builder.Services.AddExceptionHandler<DemoExceptionHandler>();
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("demo-writes", policy =>
    {
        policy.PermitLimit = 60;
        policy.Window = TimeSpan.FromMinutes(1);
        policy.QueueLimit = 0;
    });
    options.OnRejected = async (context, cancellationToken) =>
    {
        context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
        context.HttpContext.Response.Headers.RetryAfter = "60";
        context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("DemoRateLimit").LogWarning("Demo request rate limit reached");
        await Results.Problem(statusCode: 429, title: "Troppe richieste. Riprova tra un minuto.")
            .ExecuteAsync(context.HttpContext);
    };
});

var otel = builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource.AddService(StoreTelemetry.ServiceName))
    .WithTracing(tracing => tracing.AddSource(StoreTelemetry.ServiceName))
    .WithMetrics(metrics => metrics.AddMeter(StoreTelemetry.ServiceName));
if (telemetryEnabled)
{
    otel.UseAzureMonitor(options =>
    {
        options.ConnectionString = connectionString;
        options.SamplingRatio = 1.0F;
    });
}
else
{
    otel.WithTracing(tracing => tracing.AddAspNetCoreInstrumentation());
}
builder.Services.Configure<OpenTelemetry.Instrumentation.AspNetCore.AspNetCoreTraceInstrumentationOptions>(options =>
    options.Filter = context => context.Request.Path.StartsWithSegments("/api"));
builder.Services.Configure<OpenTelemetryLoggerOptions>(options => options.IncludeScopes = true);

var app = builder.Build();
using (var scope = app.Services.CreateScope())
{
    scope.ServiceProvider.GetRequiredService<StoreDb>().Seed();
}
if (!telemetryEnabled)
    app.Logger.LogWarning("Application Insights disabled: APPLICATIONINSIGHTS_CONNECTION_STRING is not configured");

app.UseExceptionHandler(new ExceptionHandlerOptions { SuppressDiagnosticsCallback = _ => false });
app.Use(async (context, next) =>
{
    if (Guid.TryParse(context.Request.Headers["X-Demo-Journey"], out var journey))
    {
        Activity.Current?.SetTag("journeyId", journey.ToString());
        using var scope = app.Logger.BeginScope(new Dictionary<string, object> { ["journeyId"] = journey.ToString() });
        await next(context);
    }
    else
    {
        await next(context);
    }
});
app.UseDefaultFiles();
app.UseStaticFiles();
app.UseRateLimiter();

app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapGet("/api/config", (HttpContext context) =>
{
    context.Response.Headers.CacheControl = "no-store";
    return Results.Ok(new
    {
        applicationInsightsConnectionString = connectionString ?? "",
        telemetryEnabled,
        demoFailureEnabled
    });
});
app.MapGet("/api/products", async (StoreDb db) =>
    Results.Ok(await db.Products.AsNoTracking().OrderBy(product => product.Id).ToListAsync()));
app.MapGet("/api/products/{id:int}", async (int id, StoreDb db) =>
    await db.Products.FindAsync(id) is { } product
        ? Results.Ok(product)
        : Results.Problem(statusCode: 404, title: "Prodotto non trovato."));

app.MapPost("/api/orders", async (CreateOrderRequest request, StoreDb db, ILogger<Program> logger) =>
{
    if (!Guid.TryParse(request.JourneyId, out var journey))
        return InvalidOrder(logger, "journeyId deve essere un UUID valido.");
    if (request.Items is not { Count: > 0 and <= 20 })
        return InvalidOrder(logger, "Inserisci da 1 a 20 righe nel carrello.");
    if (request.Items.Any(item => item is null || item.Quantity is < 1 or > 20))
        return InvalidOrder(logger, "Ogni quantita deve essere compresa tra 1 e 20.");

    var items = request.Items.OfType<CartItem>().ToList();
    if (items.Select(item => item.ProductId).Distinct().Count() != items.Count)
        return InvalidOrder(logger, "Il carrello contiene prodotti duplicati.");

    Activity.Current?.SetTag("journeyId", journey.ToString());
    using var activity = StoreTelemetry.Activities.StartActivity("store.create_order");
    activity?.SetTag("journeyId", journey.ToString());
    var order = new Order { Id = Guid.NewGuid(), CreatedAt = DateTimeOffset.UtcNow, JourneyId = journey.ToString() };
    foreach (var item in items)
    {
        var product = await db.Products.FindAsync(item.ProductId);
        if (product is null)
            return InvalidOrder(logger, "Un prodotto non esiste.");
        if (item.Quantity > product.Stock)
            return InvalidOrder(logger, "Quantita superiore alla disponibilita dimostrativa.");
        order.Items.Add(new OrderItem
        {
            ProductId = product.Id,
            Name = product.Name,
            Quantity = item.Quantity,
            UnitPrice = product.Price
        });
    }
    order.Total = order.Items.Sum(item => item.UnitPrice * item.Quantity);
    db.Orders.Add(order);
    await db.SaveChangesAsync();
    activity?.SetTag("order.id", order.Id.ToString());
    StoreTelemetry.Orders.Add(1);
    StoreTelemetry.OrderValue.Record((double)order.Total);
    var total = order.Total.ToString(CultureInfo.InvariantCulture);
    logger.LogInformation("Order {orderId} created for journey {journeyId}, total {total} EUR",
        order.Id, order.JourneyId, total);
    logger.LogInformation("{microsoft.custom_event.name} {orderId} {journeyId} {total}",
        "OrderPlaced", order.Id, order.JourneyId, total);
    return Results.Created($"/api/orders/{order.Id}", order);
}).RequireRateLimiting("demo-writes");

app.MapGet("/api/orders/{id:guid}", async (Guid id, StoreDb db) =>
    await db.Orders.AsNoTracking().FirstOrDefaultAsync(order => order.Id == id) is { } order
        ? Results.Ok(order)
        : Results.Problem(statusCode: 404, title: "Ordine non trovato o memoria azzerata."));

if (demoFailureEnabled)
{
    app.MapGet("/api/demo/failure", IResult () => throw new InvalidOperationException("Errore backend dimostrativo. Nessun pagamento eseguito."))
        .RequireRateLimiting("demo-writes");
}
app.MapFallback("/api/{**path}", () => Results.Problem(statusCode: 404, title: "Endpoint API non trovato."));
app.MapFallbackToFile("index.html");
app.Run();

static IResult InvalidOrder(ILogger logger, string reason)
{
    logger.LogWarning("Order rejected: {reason}", reason);
    return Results.Problem(statusCode: 400, title: "Carrello non valido.", detail: reason);
}

public partial class Program;

public sealed class DemoExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext httpContext, Exception exception, CancellationToken cancellationToken)
    {
        Activity.Current?.SetStatus(ActivityStatusCode.Error);
        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await problemDetails.WriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = new()
            {
                Status = 500,
                Title = "Errore del server.",
                Detail = "Richiesta non completata. Usa il traceId per verificare la telemetria."
            }
        });
        return true;
    }
}
