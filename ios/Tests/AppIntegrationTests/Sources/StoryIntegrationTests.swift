import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Persistence
import StoryFeature
import Testing
import TestSupport

/// The story view's store (web modal.js `buildArticleView`) on the fixture newsroom: extraction and
/// its fallback, key points, the block-by-block translation.
@MainActor
@Suite("The story on the fixture newsroom", .serialized)
struct StoryIntegrationTests {
    // fixture ids: story-a (rich blocks), a sports row whose extraction fails (422)
    private let storyA = "825452304de0"
    private let missing = "cd5d68db7c99"

    @MainActor
    struct World {
        let server: FixtureServer
        let preferences: PreferencesStore
        let toasts: ToastCenter
        let states: ArticleStateStore
        let articles: [Article]

        func article(_ id: String) -> Article {
            articles.first { $0.id == id }!
        }

        func story(_ article: Article, cache: ExtractionCache = ExtractionCache()) -> StoryStore {
            StoryStore(article: article, preferences: preferences, toasts: toasts, states: states, cache: cache)
        }

        func story(_ id: String, cache: ExtractionCache = ExtractionCache()) -> StoryStore {
            story(article(id), cache: cache)
        }
    }

    private func world(api: ((MeridianAPIClient) -> MeridianAPIClient)? = nil,
                       _ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root)
        try await withDependencies {
            $0.meridianAPI = api?(server.client) ?? server.client
            $0.date = .constant(server.capturedAt.date)
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
            $0.translator = .ladder()
            $0.summarizer = .ladder()
        } operation: {
            let preferences = PreferencesStore()
            let library = LibraryModel()
            let toasts = ToastCenter()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts)
            let articles = server.news(NewsQuery(pageSize: 100)).articles
            try await body(World(server: server, preferences: preferences, toasts: toasts, states: states, articles: articles))
        }
    }

    private func kind(_ block: ArticleBlock) -> String {
        switch block {
        case .paragraph: "p"
        case .heading(let level, _): "h\(level)"
        case .quote: "quote"
        case .list(let ordered, let items): "\(ordered ? "ol" : "ul")\(items.count)"
        }
    }

    @Test("the text arrives as structured blocks and is extracted once per session")
    func extraction() async throws {
        let calls = LockedValue(0)
        try await world(api: { real in
            var client = real
            client.article = { url in
                calls.update { $0 += 1 }
                return try await real.article(url)
            }
            return client
        }) { world in
            let cache = ExtractionCache()
            let first = world.story(storyA, cache: cache)
            await first.load()
            guard case .rich(let blocks) = first.body else {
                Issue.record("expected rich blocks, got \(first.body)")
                return
            }
            #expect(blocks.map(kind) == ["p", "p", "h2", "ul3", "quote", "p", "h3", "p"])
            let again = world.story(storyA, cache: cache)
            await again.load()
            #expect(again.body == first.body)
            #expect(calls.value == 1, "the second visit reads the cache")
        }
    }

    @Test("a failed extraction shows the description and the note")
    func fallback() async throws {
        try await world { world in
            let article = world.article(missing)
            let store = world.story(article)
            await store.load()
            #expect(store.body == .fallback(article.description))
            #expect(store.displayedBlocks == [.paragraph([TextRun(text: article.description)])])
        }
    }

    @Test("key points: the local rung quotes the story; another reader language gets them translated")
    func summary() async throws {
        try await world { world in
            let article = world.article(storyA)
            let text = try await world.server.client.article(article.url).text
            let english = world.story(article)
            await english.load()
            await english.summarize()
            let bullets = try #require(english.summary?.bullets)
            #expect(english.summary?.provider == "local")
            #expect((2...5).contains(bullets.count))
            // extractive: the story's own sentences (the splitter joins lines with a space, like the web)
            let flat = { (value: String) in value.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
            #expect(bullets.allSatisfy { flat(text).contains(flat($0)) })

            world.preferences.value.targetLang = "de"
            let german = world.story(article)
            await german.load()
            await german.summarize()
            #expect(german.summary?.bullets == bullets.map { "[de] " + $0 })
        }
    }

    @Test("translation keeps the blocks' shape; the chip shows the original and back without a new request")
    func translation() async throws {
        let calls = LockedValue(0)
        try await world(api: { real in
            var client = real
            client.translate = { texts, target, source in
                calls.update { $0 += 1 }
                return try await real.translate(texts, target, source)
            }
            return client
        }) { world in
            world.preferences.value.targetLang = "de"
            let article = world.article(storyA)
            let store = world.story(article)
            await store.load()
            await store.translate()
            #expect(store.showsTranslation)
            #expect(store.displayedTitle == "[de] " + article.title)
            #expect(store.displayedBlocks.map(kind) == store.currentBlocks.map(kind))
            #expect(store.displayedBlocks.allSatisfy { $0.plainText.hasPrefix("[de] ") })
            store.toggleVersion()
            #expect(!store.showsTranslation && store.displayedTitle == article.title)
            await store.translate()
            #expect(store.showsTranslation)
            #expect(calls.value == 1)
        }
    }

    @Test("an English reader is asked to pick a language first")
    func englishReader() async throws {
        try await world { world in
            let store = world.story(storyA)
            await store.load()
            await store.translate()
            #expect(store.translation == nil)
            #expect(world.toasts.toasts.map(\.text) == ["Choose a target language other than English first."])
        }
    }

    @Test("with auto-translate on the story opens translated — and fails quietly")
    func autoTranslate() async throws {
        try await world { world in
            world.preferences.value.targetLang = "de"
            world.preferences.value.autoTranslate = true
            let store = world.story(storyA)
            await store.load()
            #expect(store.showsTranslation && store.displayedTitle.hasPrefix("[de] "))
        }
        try await world(api: { real in
            var client = real
            client.translate = { _, _, _ in throw APIError.server(status: 501, code: "no-provider", message: "", retryAfter: nil) }
            return client
        }) { world in
            world.preferences.value.targetLang = "de"
            world.preferences.value.autoTranslate = true
            let store = world.story(storyA)
            await store.load()
            #expect(store.translation == nil)
            #expect(world.toasts.toasts.isEmpty, "no toast for what the reader didn't ask")
        }
    }

    @Test("a translation made from the description is dropped when the full text arrives")
    func staleTranslation() async throws {
        try await world { world in
            world.preferences.value.targetLang = "de"
            let store = world.story(storyA)
            await store.translate()
            #expect(store.translation != nil, "translated from the description while the text loads")
            await store.load()
            #expect(store.translation == nil && !store.showsTranslation)
        }
    }

    @Test("a story that came without counters fetches them")
    func counters() async throws {
        try await world { world in
            var article = world.article(storyA)
            article.reactions = nil
            let store = world.story(article)
            #expect(world.states.live(article).reactions == nil)
            await store.load()
            #expect(world.states.live(article).reactions == .zero)
        }
    }
}
