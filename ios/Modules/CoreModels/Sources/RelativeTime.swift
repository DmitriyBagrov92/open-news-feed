import Foundation

/// The freshness dot on every card: red < 1 h, grey < 6 h, faint otherwise (web `time.js`).
public enum Freshness: String, Sendable, Hashable {
    case live, recent, stale
}

/// Ports of web `public/js/time.js` — the same inputs give the same strings (golden-tested).
/// Times are epoch milliseconds; `nil` stands for the web's unparseable date (NaN).
public enum RelativeTime {
    public static let minute: Int64 = 60_000
    public static let hour: Int64 = 3_600_000

    /// A future timestamp counts as live; an invalid one as stale (NaN comparisons are false).
    public static func freshness(_ published: Int64?, now: Int64) -> Freshness {
        guard let published else { return .stale }
        let age = now - published
        if age < hour { return .live }
        if age < 6 * hour { return .recent }
        return .stale
    }

    /// "JUST NOW", "{n} MIN AGO", "1 HR AGO", "{n} HRS AGO", "1 DAY AGO", "{n} DAYS AGO".
    public static func relTime(_ published: Int64?, now: Int64) -> String {
        guard let published else { return "" }
        let minutes = max(0, now - published) / minute
        if minutes < 1 { return L10n.t("time.justNow") }
        if minutes < 60 { return L10n.t("time.min", ["n": String(minutes)]) }
        let hours = minutes / 60
        if hours == 1 { return L10n.t("time.hr") }
        if hours < 24 { return L10n.t("time.hrs", ["n": String(hours)]) }
        let days = hours / 24
        return days == 1 ? L10n.t("time.day") : L10n.t("time.days", ["n": String(days)])
    }

    /// Forecast due times: "ANY MOMENT", "WITHIN {n} HRS", "WITHIN {n} DAYS", "THIS WEEK".
    public static func relFuture(_ due: Int64?, now: Int64) -> String {
        guard let due else { return "" }
        let hours = Double(due - now) / Double(hour)
        if hours <= 1 { return L10n.t("time.anyMoment") }
        if hours < 48 { return L10n.t("time.withinHrs", ["n": String(Int(hours.rounded(.up)))]) }
        if hours < 144 { return L10n.t("time.withinDays", ["n": String(Int((hours / 24).rounded(.up)))]) }
        return L10n.t("time.thisWeek")
    }

    public static func freshness(_ published: Timestamp, now: Int64) -> Freshness {
        freshness(published.milliseconds, now: now)
    }

    public static func relTime(_ published: Timestamp, now: Int64) -> String {
        relTime(published.milliseconds, now: now)
    }
}

/// Stable hue per source, drawn from a curated ring (web `cards.js` `hashHue`): fallback tiles,
/// the ambient background and comment avatars all read colour from it.
public enum SourceHue {
    public static let ring: [Int] = [212, 228, 248, 266, 286, 312, 334, 352, 16, 32, 168, 190]

    /// `h = (h * 31 + charCode) % 4096` over UTF-16 code units, like `charCodeAt`.
    public static func hue(for string: String) -> Int {
        var hash = 0
        for unit in string.utf16 {
            hash = (hash * 31 + Int(unit)) % 4096
        }
        return ring[hash % ring.count]
    }
}
