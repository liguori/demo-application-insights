using System.Diagnostics;
using System.Diagnostics.Metrics;

namespace Store.Api;

public static class StoreTelemetry
{
    public const string ServiceName = "app-market-api";
    public static readonly ActivitySource Activities = new(ServiceName);
    public static readonly Meter Meter = new(ServiceName);
    public static readonly Counter<long> Orders = Meter.CreateCounter<long>("store.orders", "{order}");
    public static readonly Histogram<double> OrderValue = Meter.CreateHistogram<double>("store.order.value", "EUR");
}
