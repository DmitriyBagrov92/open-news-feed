import Foundation

/// An instant the way the web client sees it: integer milliseconds since the Unix epoch
/// (JavaScript `Date.parse`). The server's ISO string is kept verbatim so an article
/// round-trips byte-for-byte (saved stories, fixtures). Equality and order use the instant.
public struct Timestamp: Sendable, Comparable, Hashable, Codable, CustomStringConvertible {
    public let milliseconds: Int64
    public let iso: String

    public init(milliseconds: Int64) {
        self.milliseconds = milliseconds
        self.iso = Timestamp.format(milliseconds)
    }

    public init?(iso string: String) {
        guard let milliseconds = Timestamp.parse(string) else { return nil }
        self.milliseconds = milliseconds
        self.iso = string
    }

    public init(date: Date) {
        self.init(milliseconds: Int64((date.timeIntervalSince1970 * 1000).rounded(.down)))
    }

    public var date: Date { Date(timeIntervalSince1970: Double(milliseconds) / 1000) }
    public var description: String { iso }

    public static func == (lhs: Timestamp, rhs: Timestamp) -> Bool { lhs.milliseconds == rhs.milliseconds }
    public static func < (lhs: Timestamp, rhs: Timestamp) -> Bool { lhs.milliseconds < rhs.milliseconds }
    public func hash(into hasher: inout Hasher) { hasher.combine(milliseconds) }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        guard let milliseconds = Timestamp.parse(string) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO 8601 date-time: \(string)")
        }
        self.milliseconds = milliseconds
        self.iso = string
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(iso)
    }
}

// MARK: - ISO 8601 (the server's `toISOString()` shape, plus explicit offsets)

extension Timestamp {
    /// Parses `YYYY-MM-DDTHH:MM:SS[.fraction](Z|±HH:MM)` to epoch milliseconds; `nil` for anything
    /// else — the web's `Date.parse` → NaN, which its callers render as "" / "stale".
    public static func parse(_ string: String) -> Int64? {
        let bytes = Array(string.utf8)
        guard bytes.count >= 20 else { return nil }

        func number(_ start: Int, _ length: Int) -> Int? {
            guard start + length <= bytes.count else { return nil }
            var value = 0
            for index in start..<(start + length) {
                let byte = bytes[index]
                guard (48...57).contains(byte) else { return nil }
                value = value * 10 + Int(byte - 48)
            }
            return value
        }

        guard let year = number(0, 4), bytes[4] == UInt8(ascii: "-"),
              let month = number(5, 2), bytes[7] == UInt8(ascii: "-"),
              let day = number(8, 2), bytes[10] == UInt8(ascii: "T") || bytes[10] == UInt8(ascii: "t"),
              let hour = number(11, 2), bytes[13] == UInt8(ascii: ":"),
              let minute = number(14, 2), bytes[16] == UInt8(ascii: ":"),
              let second = number(17, 2)
        else { return nil }

        var index = 19
        var millis = 0
        if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
            index += 1
            var scale = 100
            var sawDigit = false
            while index < bytes.count, (48...57).contains(bytes[index]) {
                millis += Int(bytes[index] - 48) * scale
                scale /= 10
                sawDigit = true
                index += 1
            }
            guard sawDigit else { return nil }
        }

        guard index < bytes.count else { return nil } // a zone is required (JS would read local time)
        var offsetMinutes = 0
        switch bytes[index] {
        case UInt8(ascii: "Z"), UInt8(ascii: "z"):
            index += 1
        case UInt8(ascii: "+"), UInt8(ascii: "-"):
            let sign = bytes[index] == UInt8(ascii: "-") ? -1 : 1
            guard let offsetHours = number(index + 1, 2) else { return nil }
            var cursor = index + 3
            if cursor < bytes.count, bytes[cursor] == UInt8(ascii: ":") { cursor += 1 }
            guard let offsetMins = number(cursor, 2), offsetHours <= 23, offsetMins <= 59 else { return nil }
            offsetMinutes = sign * (offsetHours * 60 + offsetMins)
            index = cursor + 2
        default:
            return nil
        }
        guard index == bytes.count else { return nil }
        guard (1...12).contains(month), day >= 1, day <= daysInMonth(year: year, month: month),
              hour <= 23, minute <= 59, second <= 59
        else { return nil }

        let days = Int64(daysFromCivil(year: year, month: month, day: day))
        let seconds = ((days * 24 + Int64(hour)) * 60 + Int64(minute)) * 60 + Int64(second) - Int64(offsetMinutes) * 60
        return seconds * 1000 + Int64(millis)
    }

    /// `Date.prototype.toISOString()`: `YYYY-MM-DDTHH:MM:SS.sssZ` in UTC.
    public static func format(_ milliseconds: Int64) -> String {
        let (secondsTotal, millis) = floorDivide(milliseconds, 1000)
        let (daysTotal, secondOfDay) = floorDivide(secondsTotal, 86_400)
        let (year, month, day) = civilFromDays(Int(daysTotal))
        let hour = Int(secondOfDay / 3600)
        let minute = Int(secondOfDay % 3600 / 60)
        let second = Int(secondOfDay % 60)
        func pad(_ value: Int, _ width: Int) -> String {
            let digits = String(value)
            return digits.count >= width ? digits : String(repeating: "0", count: width - digits.count) + digits
        }
        return "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))T\(pad(hour, 2)):\(pad(minute, 2)):\(pad(second, 2)).\(pad(Int(millis), 3))Z"
    }

    private static func floorDivide(_ value: Int64, _ divisor: Int64) -> (Int64, Int64) {
        let quotient = value >= 0 ? value / divisor : -((-value + divisor - 1) / divisor)
        return (quotient, value - quotient * divisor)
    }

    private static func isLeap(_ year: Int) -> Bool { (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 }

    private static func daysInMonth(year: Int, month: Int) -> Int {
        switch month {
        case 2: return isLeap(year) ? 29 : 28
        case 4, 6, 9, 11: return 30
        default: return 31
        }
    }

    // Howard Hinnant's civil-calendar algorithms (proleptic Gregorian, days since 1970-01-01).
    private static func daysFromCivil(year: Int, month: Int, day: Int) -> Int {
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yearOfEra = y - era * 400
        let dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear
        return era * 146_097 + dayOfEra - 719_468
    }

    private static func civilFromDays(_ days: Int) -> (Int, Int, Int) {
        let z = days + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let dayOfEra = z - era * 146_097
        let yearOfEra = (dayOfEra - dayOfEra / 1460 + dayOfEra / 36524 - dayOfEra / 146_096) / 365
        let dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
        let mp = (5 * dayOfYear + 2) / 153
        let day = dayOfYear - (153 * mp + 2) / 5 + 1
        let month = mp < 10 ? mp + 3 : mp - 9
        return (yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day)
    }
}
