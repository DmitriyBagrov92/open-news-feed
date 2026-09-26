import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Persistence
import Testing
import TestSupport

/// Auto-translation of the cards on screen (web app.js:733-802) and the on-device rung, on the
/// fixture newsroom (the server rung answers "[de] …", the fake device "[on-device de] …").
@MainActor
@Suite("Translation on the fixture newsroom", .serialized)
struct TranslationIntegrationTests {
    @MainActor
    struct World {
        let preferences: PreferencesStore
        let toasts: ToastCenter
        let states: ArticleStateStore
        let articles: [Article]
        let requests: LockedValue<[Int]>
    }

    private func world(onDevice: OnDeviceTranslation = .unavailable, failing: Bool = false,
                       _ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root)
        let requests = LockedValue<[Int]>([])
        var client = server.client
        let real = server.client
        client.translate = { texts, target, source in
            requests.update { $0.append(texts.count) }
            if failing { throw APIError.server(status: 501, code: "no-provider", message: "", retryAfter: nil) }
            return try await real.translate(texts, target, source)
        }
        try await withDependencies {
            $0.meridianAPI = client
            $0.date = .constant(server.capturedAt.date)
            $0.continuousClock = ContinuousClock()
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
            $0.onDeviceTranslation = onDevice
        } operation: {
            let preferences = PreferencesStore()
            preferences.value.targetLang = "de"
            preferences.value.autoTranslate = true
            let library = LibraryModel()
            let toasts = ToastCenter()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts,
                                           translationBackoff: .milliseconds(400))
            let articles = server.news(NewsQuery(pageSize: 100)).articles.filter { $0.language == "en" }
            try await body(World(preferences: preferences, toasts: toasts, states: states, articles: articles, requests: requests))
        }
    }

    /// Polls a condition for up to `seconds` (the queue waits 250 ms before it asks).
    private func eventually(_ seconds: Double = 3, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    @Test("cards on screen are translated in batches of 10 stories — 20 texts — per request")
    func batches() async throws {
        try await world { world in
            let shown = Array(world.articles.prefix(15))
            shown.forEach(world.states.autoTranslate)
            #expect(await eventually { shown.allSatisfy { world.states.live($0).translation != nil } })
            #expect(world.requests.value == [20, 10])
            let first = try #require(world.states.live(shown[0]).translation)
            #expect(first.language == "de" && first.title == "[de] " + shown[0].title)
            shown.forEach(world.states.autoTranslate)
            try await Task.sleep(for: .milliseconds(400))
            #expect(world.requests.value == [20, 10], "translated once")
        }
    }

    @Test("an installed on-device pair translates without the server")
    func onDevice() async throws {
        try await world(onDevice: .fake(installed: true)) { world in
            let story = world.articles[0]
            world.states.autoTranslate(story)
            #expect(await eventually { world.states.live(story).translation != nil })
            #expect(world.states.live(story).translation?.title == "[on-device de] " + story.title)
            #expect(world.requests.value.isEmpty)
        }
    }

    @Test("a failure: one message, a pause, then the cards on screen ask again")
    func backoff() async throws {
        try await world(failing: true) { world in
            let epoch = world.states.translationEpoch
            world.articles.prefix(3).forEach(world.states.autoTranslate)
            #expect(await eventually { !world.toasts.toasts.isEmpty })
            #expect(world.toasts.toasts.map(\.text) == ["Translation is unavailable right now. Try again later."])
            world.states.autoTranslate(world.articles[5])
            try await Task.sleep(for: .milliseconds(300))
            #expect(world.requests.value == [6], "nothing more is asked while paused")
            #expect(await eventually { world.states.translationEpoch == epoch + 1 }, "the pause ends: cards re-ask")
        }
    }

    @Test("a new language reverts every translation; switching auto-translate off too")
    func settings() async throws {
        try await world { world in
            let story = world.articles[0]
            world.states.autoTranslate(story)
            #expect(await eventually { world.states.live(story).translation != nil })
            let epoch = world.states.translationEpoch
            world.preferences.value.targetLang = "fr"
            world.states.languageChanged()
            #expect(world.states.live(story).translation == nil)
            #expect(world.states.translationEpoch == epoch + 1)
            world.states.autoTranslate(story)
            #expect(await eventually { world.states.live(story).translation?.language == "fr" })
            world.preferences.value.autoTranslate = false
            world.states.autoTranslateChanged()
            #expect(world.states.live(story).translation == nil)
            world.states.autoTranslate(story)
            try await Task.sleep(for: .milliseconds(400))
            #expect(world.states.live(story).translation == nil, "off means off")
        }
    }

    @Test("English readers and stories already in the reader's language are left alone")
    func leftAlone() async throws {
        try await world { world in
            world.preferences.value.targetLang = "en"
            world.states.autoTranslate(world.articles[0])
            world.preferences.value.targetLang = "de"
            let german = Article(id: "0123456789ab", title: "Sturm", url: URL(string: "https://example.com/de")!,
                                 source: world.articles[0].source, category: "world",
                                 publishedAt: world.articles[0].publishedAt, language: "de")
            world.states.autoTranslate(german)
            try await Task.sleep(for: .milliseconds(400))
            #expect(world.requests.value.isEmpty)
        }
    }
}
