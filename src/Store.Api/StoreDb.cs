using Microsoft.EntityFrameworkCore;

namespace Store.Api;

public sealed class StoreDb(DbContextOptions<StoreDb> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>().OwnsMany(order => order.Items, items =>
        {
            items.WithOwner().HasForeignKey("OrderId");
            items.HasKey("OrderId", nameof(OrderItem.ProductId));
        });
    }

    public void Seed()
    {
        Database.EnsureCreated();
        if (Products.Any()) return;
        Products.AddRange(
            new Product(1, "Cuffie Studio", "Audio wireless per la tua giornata, con custodia da viaggio.", "Tecnologia", 89.90m, "headphones", 25),
            new Product(2, "Lampada Aurora", "Luce calda e design essenziale per la tua scrivania.", "Casa", 49.00m, "lamp", 30),
            new Product(3, "Zaino Explorer", "Leggero, versatile e pronto per la prossima avventura.", "Accessori", 69.50m, "backpack", 18),
            new Product(4, "Tastiera Cloud", "Compatta e silenziosa, per dare spazio alle idee.", "Tecnologia", 79.00m, "keyboard", 20),
            new Product(5, "Tazza Orbit", "Ceramica artigianale per le tue pause creative.", "Casa", 19.90m, "mug", 40),
            new Product(6, "Borraccia Terra", "Acciaio e isolamento termico, da portare sempre con te.", "Accessori", 29.00m, "bottle", 35));
        SaveChanges();
    }
}

public sealed record Product(int Id, string Name, string Description, string Category, decimal Price, string Image, int Stock);

public sealed class Order
{
    public Guid Id { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public decimal Total { get; set; }
    public string JourneyId { get; set; } = "";
    public List<OrderItem> Items { get; set; } = [];
}

public sealed class OrderItem
{
    public int ProductId { get; set; }
    public string Name { get; set; } = "";
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}

public sealed record CreateOrderRequest(List<CartItem?>? Items, string? JourneyId);
public sealed record CartItem(int ProductId, int Quantity);
