import CoreModels
import Foundation

/// The feed as a timeline (web `timescale.js`): 24 density buckets over the loaded range, the
/// label of the story at the top of the viewport, and seeking to a point in time.
public struct Timescale: Sendable, Equatable {
    /// Publish times in feed order (not necessarily monotonic: the hero is hoisted).
    public let times: [Int64]
    public let newest: Int64
    public let oldest: Int64

    public init?(times: [Int64]) {
        guard times.count >= 3, let newest = times.max(), let oldest = times.min(), newest > oldest else { return nil }
        self.times = times
        self.newest = newest
        self.oldest = oldest
    }

    public var range: Int64 { newest - oldest }

    /// 24 equal slices of [oldest, newest], oldest first (web `refresh`, timescale.js:113-117).
    public func buckets(_ count: Int = 24) -> [Int] {
        var result = Array(repeating: 0, count: count)
        for time in times {
            let fraction = Double(time - oldest) / Double(range)
            result[min(count - 1, max(0, Int(fraction * Double(count))))] += 1
        }
        return result
    }

    /// 0 at the newest story, 1 at the oldest.
    public func fraction(of time: Int64) -> Double {
        min(1, max(0, Double(newest - time) / Double(range)))
    }

    /// The first story at or older than the time at `fraction` (web `seek`); `nil` when the target
    /// is older than everything loaded (the caller loads the next page and retries).
    public func index(atFraction fraction: Double) -> Int? {
        let target = newest - Int64((min(1, max(0, fraction)) * Double(range)).rounded())
        return times.firstIndex { $0 <= target }
    }

    /// "NOW" at the top, else "2 HRS AGO · 14:05" (local 24 h), like the rail cursor.
    public func label(forTime time: Int64, now: Int64, timeZone: TimeZone = .current) -> String {
        if fraction(of: time) <= 0.005 { return L10n.t("ios.time.now") }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let date = Date(timeIntervalSince1970: Double(time) / 1000)
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        let clock = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        return RelativeTime.relTime(time, now: now) + " · " + clock
    }

    /// Relative labels for the rail's ticks at ¼, ½ and ¾.
    public func tickLabels(now: Int64) -> [String] {
        [0.25, 0.5, 0.75].map { RelativeTime.relTime(newest - Int64(Double(range) * $0), now: now) }
    }
}
