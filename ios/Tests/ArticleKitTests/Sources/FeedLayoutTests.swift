import ArticleKit
import CoreModels
import Foundation
import Testing

/// The mosaic follows the web's rules (app.js `variantFor` / `appendArticles` / `paintAmbient`).
@Suite("Feed layout")
struct FeedLayoutTests {
    private func article(_ index: Int, image: Bool = true, source: String = "src") -> Article {
        Article(
            id: String(format: "%012x", index),
            title: "Story \(index)",
            url: URL(string: "https://example.com/\(index)")!,
            image: image ? URL(string: "https://img.example.com/\(index).jpg") : nil,
            source: ArticleSource(id: "\(source)-\(index % 3)", name: "Source \(index % 3)", provenance: .country("GB")),
            category: "world",
            publishedAt: Timestamp(milliseconds: 1_000_000 - Int64(index) * 60_000)
        )
    }

    @Test("the first story with an image is hoisted and becomes the hero")
    func heroHoisting() {
        let articles = [article(0, image: false), article(1, image: false), article(2), article(3)]
        let items = FeedLayout.items(for: articles, withHero: true)
        #expect(items.map(\.article.id) == [articles[2].id, articles[0].id, articles[1].id, articles[3].id])
        #expect(items.map(\.variant) == [.hero, .text, .text, .wide])
    }

    @Test("every 7th image story (index % 7 == 3) is wide; later pages have no hero")
    func variants() {
        let articles = (0..<15).map { article($0) }
        let first = FeedLayout.items(for: articles, withHero: true).map(\.variant)
        #expect(first[0] == .hero)
        #expect(first[3] == .wide && first[10] == .wide)
        #expect(first.filter { $0 == .wide }.count == 2)
        let later = FeedLayout.items(for: articles, withHero: false).map(\.variant)
        #expect(!later.contains(.hero))
        #expect(later[3] == .wide)
    }

    @Test("stories already shown are skipped, but still count toward the rhythm")
    func duplicates() {
        let articles = (0..<8).map { article($0) }
        let items = FeedLayout.items(for: articles, withHero: false, excluding: [articles[1].id])
        #expect(items.count == 7)
        #expect(items.first { $0.article.id == articles[3].id }?.variant == .wide, "index 3 stays wide")
    }

    @Test("new stories prepend as rows only, never posters")
    func prepend() {
        let items = FeedLayout.prependItems([article(20), article(21, image: false)], excluding: [])
        #expect(items.map(\.variant) == [.row, .text])
    }

    @Test("compact width: one card per block, posters full width")
    func compactBlocks() {
        let items = FeedLayout.items(for: (0..<10).map { article($0) }, withHero: true)
        let blocks = FeedLayout.blocks(items, columns: 1)
        #expect(blocks.count == items.count)
        #expect(blocks.flatMap(\.items) == items, "reading order is preserved")
    }

    @Test("regular width: dense packing — rows fill beside a poster, reaching past later posters")
    func mosaicBlocks() {
        let items = FeedLayout.items(for: (0..<20).map { article($0) }, withHero: true)
        let three = FeedLayout.blocks(items, columns: 3)
        guard case .poster(let hero, let side) = three[0] else {
            Issue.record("expected a poster block first")
            return
        }
        #expect(hero.variant == .hero)
        #expect(side.count == 1 && side[0].count == 3, "the hero's side column is full (3 rows)")
        #expect(!side[0].contains { $0.variant.isPoster })
        #expect(side[0].map(\.article.id) == [items[1], items[2], items[4]].map(\.article.id), "the wide story at 3 is skipped over")
        guard case .poster(let wide, _) = three[1] else {
            Issue.record("the wide poster comes next")
            return
        }
        #expect(wide.article.id == items[3].article.id)

        for columns in [2, 3, 4] {
            let flat = FeedLayout.blocks(items, columns: columns).flatMap(\.items)
            #expect(flat.count == items.count && Set(flat.map(\.id)) == Set(items.map(\.id)), "\(columns) columns: every card once")
            let posters = flat.filter { $0.variant.isPoster }.map(\.id)
            #expect(posters == items.filter { $0.variant.isPoster }.map(\.id), "posters keep their order")
        }
        for block in FeedLayout.blocks(items, columns: 4) {
            if case .row(let row) = block { #expect(row.count <= 4) }
        }
    }

    @Test("columns: one below 700 pt, then as many card-min columns as fit")
    func columns() {
        #expect(FeedLayout.columns(forWidth: 402, cardMin: 300) == 1)
        #expect(FeedLayout.columns(forWidth: 744, cardMin: 300) == 2)
        #expect(FeedLayout.columns(forWidth: 1100, cardMin: 300) == 3)
        #expect(FeedLayout.columns(forWidth: 1366, cardMin: 300) == 4)
        #expect(FeedLayout.columns(forWidth: 1366, cardMin: 400) == 3)
    }

    @Test("ambient hues: distinct source hues ≥ 26° apart, padded by +74°, nil when empty")
    func ambient() {
        #expect(AmbientPalette.hues(for: []) == nil)
        let one = Article(id: "aaaaaaaaaaaa", title: "t", url: URL(string: "https://a.test")!,
                          source: ArticleSource(id: "bbc-world", name: "BBC World", provenance: .country("GB")),
                          category: "world", publishedAt: Timestamp(milliseconds: 0))
        let hue = SourceHue.hue(for: "bbc-world")
        #expect(AmbientPalette.hues(for: [one, one]) == [hue, (hue + 74) % 360, (hue + 148) % 360])
        let many = (0..<30).map { article($0, source: "outlet\($0)") }
        let hues = AmbientPalette.hues(for: many) ?? []
        #expect(hues.count == 3)
        for (index, a) in hues.enumerated() {
            for b in hues[(index + 1)...] {
                let distance = abs(a - b)
                #expect(distance >= 26 && distance <= 334, "\(a) vs \(b) wrap around the circle")
            }
        }
    }
}
