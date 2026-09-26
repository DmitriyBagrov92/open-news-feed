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
import YourFeedFeature

/// Your Feed on the fixture newsroom (web app.js:405-580 + recommend.js): the onboarding round,
/// what a rating does (profile, save, vote), the ranked feed and "Tune more".
@MainActor
@Suite("Your Feed on the fixture newsroom", .serialized)
struct YourFeedIntegrationTests {
    @MainActor
    struct World {
        let server: FixtureServer
        let preferences: PreferencesStore
        let library: LibraryModel
        let states: ArticleStateStore
        let toasts: ToastCenter
        let store: YourFeedStore
    }

    private func world(taste: TasteProfile? = nil, api: ((MeridianAPIClient) -> MeridianAPIClient)? = nil,
                       _ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root)
        try await withDependencies {
            $0.meridianAPI = api?(server.client) ?? server.client
            $0.date = .constant(server.capturedAt.date)
            $0.continuousClock = ContinuousClock()
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
        } operation: {
            let preferences = PreferencesStore()
            if let taste { preferences.value.taste = taste }
            let library = LibraryModel()
            await library.load()
            let toasts = ToastCenter()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts)
            let store = YourFeedStore(preferences: preferences, library: library, sources: SourcesModel(), states: states, toasts: toasts)
            try await body(World(server: server, preferences: preferences, library: library, states: states, toasts: toasts, store: store))
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

    /// The 100 newest, as the store asks for them.
    private func pool(_ world: World) -> [Article] {
        world.server.news(NewsQuery(pageSize: 100)).articles
    }

    @Test("a fresh reader starts with a round of five diverse, unseen stories")
    func onboardingDeck() async throws {
        try await world { world in
            await world.store.appear()
            #expect(world.store.phase == .onboarding)
            #expect(world.store.deck == .ready)
            let expected = TasteEngine.onboardingCandidates(pool(world), taste: TasteProfile(), saved: [])
            #expect(world.store.card?.id == expected.first?.id)
            #expect(world.store.batchDone == 0 && world.store.batchTotal == 5)
        }
    }

    @Test("five ratings: the profile learns, likes are saved, votes move; then the ranked feed")
    func onboardingRound() async throws {
        try await world { world in
            await world.store.appear()
            var rated: [(Article, Int)] = []
            for dir in [1, -1, 1, 1, -1] {
                let card = try #require(world.store.card)
                rated.append((card, dir))
                world.store.rate(dir)
            }
            #expect(world.preferences.value.taste.count == 5)
            #expect(world.preferences.value.taste.rated == Array(rated.map(\.0.id).reversed()))
            let liked = rated.filter { $0.1 == 1 }.map(\.0.id)
            #expect(await eventually { Set(world.library.articles.map(\.id)) == Set(liked) }, "a like is a save")
            #expect(await eventually {
                rated.allSatisfy { article, dir in world.states.live(article).reactions?.myVote == (dir == 1 ? .up : .down) }
            }, "likes vote up, skips vote down")
            #expect(await eventually { world.store.phase == .recommended })
            #expect(world.toasts.toasts.map(\.text).contains("Your feed is ready"))
            let shown = Set(world.store.recommended.map(\.id))
            #expect(!shown.isEmpty)
            #expect(shown.isDisjoint(with: rated.map(\.0.id)), "rated and saved stories are not recommended")
        }
    }

    @Test("a rating only sets the vote: a story already voted up stays up")
    func ratingSetsTheVote() async throws {
        try await world { world in
            let article = pool(world)[3]
            await world.states.vote(article, .up)
            await world.states.rate(article, .up)
            #expect(world.states.live(article).reactions?.myVote == .up)
            await world.states.rate(article, .down)
            #expect(world.states.live(article).reactions?.myVote == .down)
        }
    }

    @Test("a tuned profile goes straight to the ranking of the 100 newest")
    func recommended() async throws {
        var taste = TasteProfile(count: 5)
        taste.cats["sports"] = 5
        taste.sources["espn"] = 4
        try await world(taste: taste) { world in
            await world.store.appear()
            #expect(world.store.phase == .recommended)
            let now = Int64(world.server.capturedAt.date.timeIntervalSince1970 * 1000)
            let expected = TasteEngine.rank(pool(world), taste: taste, saved: [], now: now)
            #expect(world.store.recommended.map(\.id) == expected.articles.map(\.id))
            #expect(world.store.recommended.first?.category == "sports")
            #expect(world.toasts.toasts.isEmpty, "personalized: no fallback note")
        }
    }

    @Test("a profile that shapes nothing says the feed shows the freshest for now")
    func fallback() async throws {
        try await world(taste: TasteProfile(count: 5)) { world in
            await world.store.appear()
            #expect(world.store.phase == .recommended)
            #expect(world.toasts.toasts.map(\.text) == ["Rate a few more stories and this feed gets sharper — showing the freshest for now."])
        }
    }

    @Test("Tune more: another round of five, rated stories left out")
    func tuneMore() async throws {
        var taste = TasteProfile(count: 5)
        let seen = ["825452304de0", "b52427f78777"]
        taste.rated = seen
        try await world(taste: taste) { world in
            await world.store.appear()
            await world.store.startOnboarding()
            #expect(world.store.phase == .onboarding && world.store.deck == .ready)
            #expect(world.store.batchDone == 0)
            let card = try #require(world.store.card)
            #expect(!seen.contains(card.id))
        }
    }

    @Test("a failed pool: the deck says so; the ranked feed shows the error")
    func failures() async throws {
        try await world(api: { real in
            var client = real
            client.news = { _ in throw APIError.network(.notConnectedToInternet) }
            return client
        }) { world in
            await world.store.appear()
            #expect(world.store.deck == .failed)
        }
        try await world(taste: TasteProfile(count: 5), api: { real in
            var client = real
            client.news = { _ in throw APIError.network(.notConnectedToInternet) }
            return client
        }) { world in
            await world.store.appear()
            #expect(world.store.phase == .failed(offline: true))
        }
    }
}
