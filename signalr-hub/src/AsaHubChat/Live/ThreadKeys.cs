using System.Text.RegularExpressions;

namespace AsaHubChat.Live;

/// <summary>A thread is the sorted pair of two person ids (Chat.gs chatThreadKey_); there is no thread table.</summary>
public static partial class ThreadKeys
{
    [GeneratedRegex(@"^[^|\s]{1,200}$")]
    private static partial Regex PersonIdPattern();

    [GeneratedRegex(@"^[A-Za-z0-9_-]{8,64}$")]
    private static partial Regex ClientIdPattern();

    public static bool ValidPersonId(string? id) => id is not null && PersonIdPattern().IsMatch(id);

    public static bool ValidClientId(string? id) => id is not null && ClientIdPattern().IsMatch(id);

    /// <summary>The key of the thread between two ids, ordinal order as JavaScript's `&lt;` compares them.</summary>
    public static string? For(string me, string other)
    {
        if (!ValidPersonId(me) || !ValidPersonId(other) || me == other)
        {
            return null;
        }
        return string.CompareOrdinal(me, other) < 0 ? $"{me}|{other}" : $"{other}|{me}";
    }

    /// <summary>Whether one side of the pair is one of the caller's own ids.</summary>
    public static bool Owns(string? key, IEnumerable<string> foldIds)
    {
        if (string.IsNullOrEmpty(key))
        {
            return false;
        }
        var parts = key.Split('|');
        if (parts.Length != 2 || parts[0].Length == 0 || parts[1].Length == 0)
        {
            return false;
        }
        return foldIds.Any(id => id == parts[0] || id == parts[1]);
    }

    public static string PersonGroup(string id) => "p:" + id;

    public static string ThreadGroup(string key) => "t:" + key;
}
