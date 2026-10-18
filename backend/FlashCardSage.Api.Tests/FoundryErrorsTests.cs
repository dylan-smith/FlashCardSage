using FlashCardSage.Api.Suggestions.Foundry;

namespace FlashCardSage.Api.Tests;

public class FoundryErrorsTests
{
    [Theory]
    [InlineData("""{"error":{"code":"DeploymentNotFound","message":"Not there."}}""", "DeploymentNotFound")]
    [InlineData(
        """{"error":{"code":"content_filter","inner_error":{"code":"ResponsibleAIPolicyViolation"}}}""",
        "ResponsibleAIPolicyViolation")]
    [InlineData("""{"error":{"code":"content_filter","inner_error":{"message":"No code."}}}""", "content_filter")]
    [InlineData("""{"error":{"code":"content_filter","inner_error":"text"}}""", "content_filter")]
    [InlineData("""{"error":{"code":401}}""", null)]
    [InlineData("""{"error":"boom"}""", null)]
    [InlineData("""["error"]""", null)]
    [InlineData("not json", null)]
    [InlineData("", null)]
    public void Code_IsTheErrorsCode_PreferringTheInnerErrors(string body, string? expected)
    {
        Assert.Equal(expected, FoundryErrors.Code(body));
    }
}
