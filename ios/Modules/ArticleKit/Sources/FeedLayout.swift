import CoreModels
import Foundation

/// A card's shape follows its content (web `variantFor`, app.js:231-236).
public enum CardVariant: String, Sendable, Hashable {
    /// 4:5 poster — the freshest story with an image on a fresh page.
    case hero
    /// 16:10 poster — every 7th image story, for rhythm.
    case wide
    /// Row with the thumbnail on the right.
    case row
    /// Row without an image.
    case text

    public var isPoster: Bool { self == .hero || self == .wide }
}

public struct FeedItem: Sendable, Hashable, Identifiable {
    public let article: Article
    public let variant: CardVariant
    public var id: String { article.id }

    public init(article: Article, variant: CardVariant) {
        self.article = article
        self.variant = variant
    }
}

/// A lazily laid-out unit of the feed: one row of cards, or a poster with rows stacked beside it
/// (regular width). On compact width every block holds one card.
public enum FeedBlock: Sendable, Hashable, Identifiable {
    case row([FeedItem])
    /// `side`: columns of stacked cards beside a poster spanning two columns.
    case poster(FeedItem, side: [[FeedItem]])

    public var id: String {
        switch self {
        case .row(let items): "row-" + items.map(\.id).joined(separator: "-")
        case .poster(let item, _): "poster-" + item.id
        }
    }

    /// Reading order (the story pager walks this).
    public var items: [FeedItem] {
        switch self {
        case .row(let items): items
        case .poster(let item, let side): [item] + side.flatMap { $0 }
        }
    }
}

public enum FeedLayout {
    /// The web's `appendArticles` (app.js:268-292): with a hero, the first story that has an image
    /// is hoisted to the top; variants by position (`i` counts skipped duplicates too); stories
    /// already shown are skipped.
    public static func items(for articles: [Article], withHero: Bool, excluding shown: Set<String> = []) -> [FeedItem] {
        var ordered = articles
        if withHero, let heroIndex = ordered.firstIndex(where: { $0.image != nil }), heroIndex > 0 {
            ordered.insert(ordered.remove(at: heroIndex), at: 0)
        }
        var seen = shown
        var out: [FeedItem] = []
        for (index, article) in ordered.enumerated() {
            guard seen.insert(article.id).inserted else { continue }
            out.append(FeedItem(article: article, variant: variant(for: article, at: index, withHero: withHero)))
        }
        return out
    }

    public static func variant(for article: Article, at index: Int, withHero: Bool) -> CardVariant {
        if withHero, index == 0, article.image != nil { return .hero }
        if article.image == nil { return .text }
        return index % 7 == 3 ? .wide : .row
    }

    /// Stories prepended from the "new stories" pill: rows only, never posters (web `prependArticles`).
    public static func prependItems(_ articles: [Article], excluding shown: Set<String>) -> [FeedItem] {
        var seen = shown
        return articles.compactMap { article in
            guard seen.insert(article.id).inserted else { return nil }
            return FeedItem(article: article, variant: article.image == nil ? .text : .row)
        }
    }

    /// Columns for a content width: one below 700 pt (the web's compact grid), otherwise as many
    /// `cardMin`-wide columns as fit with the web's 32 pt gutter.
    public static func columns(forWidth width: CGFloat, cardMin: CGFloat, gutter: CGFloat = 32) -> Int {
        guard width >= 700 else { return 1 }
        return max(2, Int((width + gutter) / (cardMin + gutter)))
    }

    /// Packs cards into blocks like the web's dense grid (`grid-auto-flow: dense`): a poster spans
    /// two columns and 3 (hero) or 2 (wide) row heights; the next rows fill the columns beside it
    /// top to bottom — reaching past a later poster when needed, so no gap opens — and the rest
    /// continue in rows. Posters keep their relative order.
    public static func blocks(_ items: [FeedItem], columns: Int) -> [FeedBlock] {
        guard columns > 1 else {
            return items.map { $0.variant.isPoster ? .poster($0, side: []) : .row([$0]) }
        }
        var remaining = items
        var blocks: [FeedBlock] = []
        var pending: [FeedItem] = []
        func flush() {
            if !pending.isEmpty { blocks.append(.row(pending)) }
            pending = []
        }
        while !remaining.isEmpty {
            let item = remaining.removeFirst()
            guard item.variant.isPoster else {
                pending.append(item)
                if pending.count == columns { flush() }
                continue
            }
            flush()
            let span = item.variant == .hero ? 3 : 2
            let sideColumns = columns - 2
            var side: [[FeedItem]] = Array(repeating: [], count: sideColumns)
            var taken = 0
            var index = 0
            while sideColumns > 0, taken < sideColumns * span, index < remaining.count {
                if remaining[index].variant.isPoster {
                    index += 1
                    continue
                }
                side[taken / span].append(remaining.remove(at: index))
                taken += 1
            }
            blocks.append(.poster(item, side: side.filter { !$0.isEmpty }))
        }
        flush()
        return blocks
    }
}

/// The ambient background's three hues from the lead stories' sources (web `paintAmbient`,
/// app.js:98-111): the first 14 stories, hues at least 26° apart, padded by +74°.
public enum AmbientPalette {
    public static let defaults = [214, 268, 190]

    /// `nil` when there is nothing to take a hue from — keep the previous colours.
    public static func hues(for articles: [Article]) -> [Int]? {
        var hues: [Int] = []
        for article in articles.prefix(14) {
            let key = article.source.id.isEmpty ? (article.source.name.isEmpty ? "?" : article.source.name) : article.source.id
            let hue = SourceHue.hue(for: key)
            if !hues.contains(where: { abs($0 - hue) < 26 || abs($0 - hue) > 334 }) { hues.append(hue) }
            if hues.count == 3 { break }
        }
        guard let last = hues.last else { return nil }
        var padded = hues
        var previous = last
        while padded.count < 3 {
            previous = (previous + 74) % 360
            padded.append(previous)
        }
        return padded
    }
}
