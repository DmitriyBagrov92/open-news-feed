import ArticleKit
import CoreModels
import Foundation
import Testing

@Suite("Timescale (web timescale.js)")
struct TimescaleTests {
    private let hour: Int64 = 3_600_000

    @Test("needs three distinct times")
    func minimum() {
        #expect(Timescale(times: [1, 2]) == nil)
        #expect(Timescale(times: [5, 5, 5]) == nil)
        #expect(Timescale(times: [3, 2, 1]) != nil)
    }

    @Test("24 equal slices, oldest first; the newest lands in the last bucket")
    func buckets() throws {
        let scale = try #require(Timescale(times: [24 * hour, 23 * hour, 12 * hour, 0]))
        let buckets = scale.buckets()
        #expect(buckets.count == 24)
        #expect(buckets.reduce(0, +) == 4)
        #expect(buckets[0] == 1 && buckets[23] == 2 && buckets[12] == 1)
    }

    @Test("seeking finds the first story at or older than the target, in feed order")
    func seek() throws {
        // a hoisted hero (the web's order is not monotonic)
        let times = [10 * hour, 12 * hour, 11 * hour, 9 * hour, 5 * hour, 2 * hour]
        let scale = try #require(Timescale(times: times))
        #expect(scale.index(atFraction: 0) == 0, "0 → the first card at or older than NOW (web: feed order)")
        #expect(scale.index(atFraction: 1) == 5, "1 → the oldest")
        #expect(scale.index(atFraction: 0.5) == 4, "7 h: the first ≤ 7 h is at index 4")
        #expect(scale.fraction(of: 12 * hour) == 0)
        #expect(scale.fraction(of: 2 * hour) == 1)
    }

    @Test("labels: NOW at the top, otherwise relative time and a 24-hour clock")
    func labels() throws {
        let newest = Timestamp(iso: "2026-09-26T12:00:00.000Z")!.milliseconds
        let scale = try #require(Timescale(times: [newest, newest - 2 * hour, newest - 10 * hour]))
        #expect(scale.label(forTime: newest, now: newest) == "NOW")
        #expect(scale.label(forTime: newest - 2 * hour, now: newest, timeZone: TimeZone(identifier: "UTC")!) == "2 HRS AGO · 10:00")
        #expect(scale.tickLabels(now: newest) == ["2 HRS AGO", "5 HRS AGO", "7 HRS AGO"])
    }
}

@Suite("Row swipe rules (web cards.js)")
struct SwipeRulesTests {
    @Test("the row follows the finger up to ±112 pt")
    func offset() {
        #expect(SwipeRules.offset(for: 50) == 50)
        #expect(SwipeRules.offset(for: 300) == 112)
        #expect(SwipeRules.offset(for: -300) == -112)
    }

    @Test("releasing past 72 pt commits: right saves (leading), left translates (trailing)")
    func commit() {
        #expect(SwipeRules.committedEdge(for: 71) == nil)
        #expect(SwipeRules.committedEdge(for: 72) == .leading)
        #expect(SwipeRules.committedEdge(for: -72) == .trailing)
        #expect(SwipeRules.committedEdge(for: -10) == nil)
    }
}
