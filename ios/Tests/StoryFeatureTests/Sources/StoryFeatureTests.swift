import ArticleKit
import CoreModels
import Foundation
import StoryFeature
import Testing

@Suite("Story rendering helpers")
struct StoryFeatureTests {
    @Test("runs keep bold and italic; only http(s) links become links")
    func blockText() {
        let runs = [
            TextRun(text: "Read "),
            TextRun(text: "the tariffs story", href: URL(string: "https://www.theguardian.com/fixture/story-b"), bold: true),
            TextRun(text: " now", italic: true),
            TextRun(text: " call", href: URL(string: "tel:+441234")),
        ]
        let text = BlockText.attributed(runs)
        #expect(String(text.characters) == "Read the tariffs story now call")
        let linked = text.runs.filter { $0.link != nil }
        #expect(linked.map(\.link) == [URL(string: "https://www.theguardian.com/fixture/story-b")])
        #expect(linked.first?.inlinePresentationIntent == .stronglyEmphasized)
        #expect(text.runs.contains { $0.inlinePresentationIntent == .emphasized })
    }

    @MainActor
    @Test("the extraction cache keeps the most recently read bodies")
    func extractionCache() {
        let cache = ExtractionCache(capacity: 2)
        let body = { (text: String) in ArticleBody(title: text, text: text) }
        cache.store(body("a"), for: "a")
        cache.store(body("b"), for: "b")
        #expect(cache.body(for: "a")?.text == "a") // a is now the freshest
        cache.store(body("c"), for: "c")
        #expect(cache.body(for: "b") == nil, "b was the least recently read")
        #expect(cache.body(for: "a") != nil && cache.body(for: "c") != nil)
    }
}
