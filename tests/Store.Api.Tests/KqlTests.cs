using Kusto.Language;

namespace Store.Api.Tests;

public sealed class KqlTests
{
    [Theory]
    [InlineData("azure-queries.kql")]
    public void DocumentedKqlHasValidSyntax(string fileName)
    {
        var text = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Queries", fileName));
        var blocks = text.Replace("\r\n", "\n").Split("\n\n", StringSplitOptions.RemoveEmptyEntries);
        foreach (var block in blocks)
        {
            var diagnostics = KustoCode.Parse(block).GetSyntaxDiagnostics();
            Assert.True(diagnostics.Count == 0, $"{fileName}: {string.Join("; ", diagnostics.Select(diagnostic => diagnostic.Message))}");
        }
    }
}
