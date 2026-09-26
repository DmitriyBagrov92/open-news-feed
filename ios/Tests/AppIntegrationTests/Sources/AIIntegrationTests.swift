import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import FeedFeature
import Foundation
import Intelligence
import Networking
import Persistence
import Testing
import TestSupport

/// The brief and the Ahead forecast on the fixture newsroom (the server's summarize answers 501,
/// its translate "[de] …"), with the fake model of the UI tests or none at all.
@MainActor
@Suite("Brief and forecast on the fixture newsroom", .serialized)
struct AIIntegrationTests {
    @MainActor
    struct World {
        let preferences: PreferencesStore
        let sources: SourcesModel
        let states: ArticleStateStore
        let toasts: ToastCenter

        func feed(_ category: NewsCategory = .all, search: Bool = false) -> FeedStore {
            FeedStore(category: category, search: search, preferences: preferences, sources: sources, states: states, toasts: toasts)
        }
    }

    private func world(model: LanguageModelClient = .unavailable, api: ((MeridianAPIClient) -> MeridianAPIClient)? = nil,
                       _ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root)
        try await withDependencies {
            $0.meridianAPI = api?(server.client) ?? server.client
            $0.date = .constant(server.capturedAt.date)
            $0.continuousClock = ContinuousClock()
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
            $0.languageModel = model
        } operation: {
            let preferences = PreferencesStore()
            let library = LibraryModel()
            let toasts = ToastCenter()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts)
            try await body(World(preferences: preferences, sources: SourcesModel(), states: states, toasts: toasts))
        }
    }

    private func eventually(_ seconds: Double = 3, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    // MARK: Brief

    @Test("without a model the brief is the local digest of the 20 freshest stories, thinking until it lands")
    func briefLocal() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            #expect(feed.isBriefThinking, "the thinking state shows at once, the run is debounced")
            await feed.runBrief()
            let digest = LocalDigest.brief(feed.newestFirst.prefix(20).map(DigestItem.init))
            #expect(feed.brief == TextKit.toBullets(digest.joined(separator: "\n"), max: 7))
            #expect(feed.briefProvider == "local")
            #expect(!feed.isBriefThinking)
        }
    }

    @Test("Apple Intelligence writes the brief when it is there")
    func briefOnDevice() async throws {
        try await world(model: .fake("points")) { world in
            let feed = world.feed()
            await feed.reload()
            await feed.runBrief()
            #expect(feed.briefProvider == "on-device")
            #expect(!feed.brief.isEmpty && feed.brief.allSatisfy { $0.hasPrefix("On-device: ") })
        }
    }

    @Test("a refusal falls back to the local digest")
    func briefRefused() async throws {
        try await world(model: .fake("refusal")) { world in
            let feed = world.feed()
            await feed.reload()
            await feed.runBrief()
            #expect(feed.briefProvider == "local")
            #expect(!feed.brief.isEmpty)
        }
    }

    @Test("the local digest is translated for a reader of another language; the brief follows a language change")
    func briefLanguage() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            await feed.runBrief()
            let english = feed.brief
            world.preferences.value.targetLang = "de"
            feed.languageChanged()
            #expect(feed.isBriefThinking)
            #expect(await eventually { !feed.isBriefThinking })
            #expect(feed.brief == english.map { "[de] " + $0 })
            #expect(feed.briefProvider == "local")
        }
    }

    @Test("off screen the brief waits, and runs once the reader is back")
    func briefDeferred() async throws {
        try await world { world in
            let feed = world.feed()
            feed.isOnScreen = false
            await feed.reload()
            await feed.runBrief()
            #expect(feed.brief.isEmpty && !feed.isBriefThinking, "no thinking bars nobody sees")
            feed.isOnScreen = true
            #expect(feed.isBriefThinking, "back on screen: thinking at once, the run 2 s later")
            #expect(await eventually(4) { !feed.brief.isEmpty })
            #expect(!feed.isBriefThinking)
        }
    }

    @Test("a new view thinks at once and never shows the old view's brief; a view that cannot load says so")
    func briefFollowsTheView() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            await feed.runBrief()
            let all = feed.brief
            feed.select(.sports)
            #expect(await eventually { feed.isBriefThinking })
            #expect(await eventually { !feed.isBriefThinking })
            #expect(feed.brief != all && !feed.brief.isEmpty)
        }
        try await world(api: { real in
            var client = real
            client.news = { _ in throw APIError.network(.notConnectedToInternet) }
            return client
        }) { world in
            let feed = world.feed()
            await feed.reload()
            #expect(feed.isBriefFailed && !feed.isBriefThinking && feed.brief.isEmpty)
        }
    }

    @Test("search results have no brief")
    func briefNotForSearch() async throws {
        try await world { world in
            let feed = world.feed(search: true)
            await feed.setSearch("storm", in: .all)
            #expect(!feed.isBriefThinking && feed.brief.isEmpty)
        }
    }

    // MARK: Forecast

    @Test("✦ drafts four speculative forecasts from the stories in view; the chips point at real stories")
    func forecast() async throws {
        try await world(model: .fake("points")) { world in
            let feed = world.feed()
            await feed.reload()
            let store = ForecastStore()
            #expect(store.isSupported)
            store.open(feed)
            #expect(store.phase == .thinking)
            #expect(await eventually { if case .shown = store.phase { true } else { false } })
            guard case .shown(let entry) = store.phase else { return }
            #expect(entry.forecasts.count == ForecastKit.count)
            #expect(entry.provider == "mock" && entry.language == "en")
            let ids = Set(feed.items.map(\.id))
            #expect(entry.forecasts.allSatisfy { !$0.basis.isEmpty && $0.basis.allSatisfy { ids.contains($0) && entry.articles[$0] != nil } })
            #expect(zip(entry.forecasts, entry.forecasts.dropFirst()).allSatisfy { $0.dueAt <= $1.dueAt }, "soonest first")
        }
    }

    @Test("a forecast is kept for its view: reopening shows it at once; a language change or another view runs anew")
    func forecastCache() async throws {
        try await world(model: .fake("points")) { world in
            let feed = world.feed()
            await feed.reload()
            let store = ForecastStore()
            store.open(feed)
            #expect(await eventually { if case .shown = store.phase { true } else { false } })
            let first = store.phase
            store.close()
            #expect(store.phase == .idle)
            store.open(feed)
            #expect(store.phase == first, "cached: no second run")
            store.close()

            let worldNews = world.feed(.world)
            await worldNews.reload()
            store.open(worldNews)
            #expect(store.phase == .thinking, "another view has its own forecast")
            store.close()

            store.languageChanged()
            store.open(feed)
            #expect(store.phase == .thinking, "a new language drops every cached forecast")
            store.close()
        }
    }

    @Test("closing the sheet drops an unfinished run")
    func forecastClosed() async throws {
        try await world(model: .fake("points")) { world in
            let feed = world.feed()
            await feed.reload()
            let store = ForecastStore()
            store.open(feed)
            store.close()
            try await Task.sleep(for: .milliseconds(900))
            #expect(store.phase == .idle)
            store.open(feed)
            #expect(store.phase == .thinking, "nothing was cached")
            store.close()
        }
    }

    @Test("fewer than five English stories: a note, no run")
    func forecastTooFew() async throws {
        try await world(model: .fake("points")) { world in
            let feed = world.feed(search: true)
            await feed.setSearch("storm", in: .all)
            let store = ForecastStore()
            store.open(feed)
            #expect(store.phase == .note("forecast.tooFew", retry: false))
        }
    }

    @Test("without Apple Intelligence there is no ✦; a model still downloading says so")
    func forecastAvailability() async throws {
        try await world { _ in
            #expect(!ForecastStore().isSupported)
        }
        let downloading = LanguageModelClient(availability: { .notReady }, languages: { [] },
                                              respond: { _, _ in throw LanguageModelError.unavailable },
                                              forecast: { _, _, _, _ in throw LanguageModelError.unavailable })
        try await world(model: downloading) { world in
            let feed = world.feed()
            await feed.reload()
            let store = ForecastStore()
            #expect(store.isSupported)
            store.open(feed)
            #expect(store.phase == .note("ios.ahead.notReady", retry: true))
        }
    }
}
