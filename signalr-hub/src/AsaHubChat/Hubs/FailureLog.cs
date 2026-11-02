using Microsoft.AspNetCore.SignalR;

namespace AsaHubChat.Hubs;

/// <summary>
/// SignalR's dispatcher writes every exception a hub method throws at Error, message included, and a refusal's
/// message can carry the relay's or Apps Script's words; its category is kept out of the log (Program.cs). What
/// stays worth a line — a hub method that failed on a fault, not a refusal — is written here by the method's name
/// and the fault's type alone. A HubException is the caller's answer, not a fault.
/// </summary>
public sealed class FailureLog : IHubFilter
{
    private readonly ILogger<FailureLog> log;

    public FailureLog(ILogger<FailureLog> log) => this.log = log;

    public async ValueTask<object?> InvokeMethodAsync(HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(invocationContext);
        }
        catch (Exception exc) when (exc is not HubException && exc is not OperationCanceledException)
        {
            log.LogWarning("hub method {Method} failed ({Error})", invocationContext.HubMethodName, exc.GetType().Name);
            throw;
        }
    }
}
