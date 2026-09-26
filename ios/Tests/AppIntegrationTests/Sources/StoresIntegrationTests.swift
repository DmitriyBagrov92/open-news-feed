import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import FeedFeature
import Foundation
import Networking
import Persistence
import Testing
import TestSupport

/// The feed, the shared article state and the library working together against the fixture
/// newsroom — the same data the Node server serves in fixture mode.
@MainActor
@Suite("Stores on the fixture newsroom", .serialized)
struct StoresIntegrationTests {
    /// The app-wide objects, built inside a dependency context.
    @MainActor
    struct World {
        let server: FixtureServer
        let preferences: PreferencesStore
        let library: LibraryModel
        let toasts: ToastCenter
        let sources: SourcesModel
        let states: ArticleStateStore

        func feed(_ category: NewsCategory = .all, search: Bool = false) -> FeedStore {
            FeedStore(category: category, search: search, preferences: preferences, sources: sources, states: states, toasts: toasts)
        }
    }

    private func world(newStories: Bool = false, api: ((MeridianAPIClient) -> MeridianAPIClient)? = nil,
                       _ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root, newStories: newStories)
        try await withDependencies {
            $0.meridianAPI = api?(server.client) ?? server.client
            $0.date = .constant(server.capturedAt.date)
            $0.continuousClock = ContinuousClock() // the brief's debounce
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
        } operation: {
            let preferences = PreferencesStore()
            let library = LibraryModel()
            let toasts = ToastCenter()
            let sources = SourcesModel()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts)
            try await body(World(server: server, preferences: preferences, library: library, toasts: toasts, sources: sources, states: states))
        }
    }

    // MARK: Feed

    @Test("pages of 30 without duplicates until the newsroom runs out; a hero leads page 1")
    func paging() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            #expect(feed.phase == .loaded)
            #expect(feed.items.count == 30 && feed.hasMore)
            #expect(feed.items.first?.variant == .hero)
            await feed.loadMore()
            await feed.loadMore()
            #expect(feed.items.count == 73)
            #expect(!feed.hasMore)
            #expect(Set(feed.items.map(\.id)).count == feed.items.count)
            #expect(feed.items.dropFirst(30).allSatisfy { $0.variant != .hero }, "later pages have no hero")
        }
    }

    @Test("a failing page backs off with one toast instead of retrying in a loop")
    func backoff() async throws {
        let failures = LockedValue(0)
        try await world(api: { real in
            var client = real
            client.news = { query in
                if query.page > 1 {
                    failures.update { $0 += 1 }
                    throw APIError.network(.notConnectedToInternet)
                }
                return try await real.news(query)
            }
            return client
        }) { world in
            let feed = world.feed()
            await feed.reload()
            await feed.loadMore()
            await feed.loadMore()
            await feed.loadMore()
            #expect(failures.value == 1, "the clock has not moved: every retry waits for the back-off")
            #expect(world.toasts.toasts.map(\.text) == ["More stories could not be loaded."])
            #expect(feed.items.count == 30)
        }
    }

    @Test("new stories wait behind the pill, prepend as rows, glow, and are not found twice")
    func newStories() async throws {
        try await world(newStories: true) { world in
            let feed = world.feed()
            await feed.reload()
            await feed.pollNew()
            #expect(feed.pending.count == 3)
            let fresh = feed.pending.map(\.id)
            feed.showPending()
            #expect(feed.pending.isEmpty)
            #expect(Array(feed.items.prefix(3).map(\.id)) == fresh)
            #expect(feed.items.prefix(3).allSatisfy { !$0.variant.isPoster })
            #expect(feed.fresh == Set(fresh))
            await feed.pollNew()
            #expect(feed.pending.isEmpty, "the newest story moved on")
        }
    }

    @Test("hidden sources never reach the feed; a category filters it")
    func filters() async throws {
        try await world { world in
            world.preferences.value.hiddenSources = ["bbc-world", "espn"]
            let feed = world.feed()
            await feed.reload()
            #expect(!feed.items.contains { ["bbc-world", "espn"].contains($0.article.source.id) })
            let sports = world.feed(.sports)
            await sports.reload()
            #expect(!sports.items.isEmpty && sports.items.allSatisfy { $0.article.category == "sports" })
        }
    }

    @Test("a target language with native feeds mixes them in (lang=de,en)")
    func nativeLanguage() async throws {
        try await world { world in
            await world.sources.load()
            #expect(world.sources.nativeLanguages.contains("de"))
            world.preferences.value.targetLang = "de"
            let feed = world.feed()
            await feed.reload()
            await feed.loadMore()
            await feed.loadMore()
            #expect(feed.items.contains { $0.article.language == "de" })
        }
    }

    @Test("search: one character is ignored, two search, empty clears")
    func search() async throws {
        try await world { world in
            let feed = world.feed(search: true)
            await feed.setSearch("s", in: .all)
            #expect(feed.search == nil)
            await feed.setSearch("storm", in: .all)
            #expect(feed.search == "storm")
            #expect(!feed.items.isEmpty && feed.items.allSatisfy {
                ($0.article.title + " " + $0.article.description).lowercased().contains("storm")
            })
            await feed.setSearch("zzqqxx", in: .all)
            #expect(feed.phase == .empty)
            await feed.setSearch("", in: .all)
            #expect(feed.search == nil && feed.items.isEmpty)
        }
    }

    @Test("reactions refresh visible stories first, capped at 150")
    func reactionIDs() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            feed.visibleIDs = [feed.items[5].id, feed.items[6].id]
            await feed.refreshReactions()
            #expect(world.states.live(feed.items[5].article).reactions == .zero)
        }
    }

    // MARK: Article state

    @Test("votes are optimistic, a second tap retracts")
    func votes() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            let article = feed.items[1].article
            await world.states.vote(article, .up)
            #expect(world.states.live(article).reactions?.myVote == .up)
            #expect(world.states.live(article).reactions?.up == 1)
            await world.states.vote(article, .up)
            #expect(world.states.live(article).reactions?.myVote == nil)
            #expect(world.states.live(article).reactions?.up == 0)
            await world.states.vote(article, .down)
            #expect(world.states.live(article).reactions?.down == 1)
        }
    }

    @Test("a refused vote rolls back with the web's copy")
    func voteRollback() async throws {
        try await world(api: { real in
            var client = real
            client.voteArticle = { _, _ in
                throw APIError.server(status: 404, code: "unknown-article", message: "closed", retryAfter: nil)
            }
            return client
        }) { world in
            let feed = world.feed()
            await feed.reload()
            let article = feed.items[2].article
            await world.states.vote(article, .down)
            #expect(world.states.live(article).reactions == .zero)
            #expect(world.toasts.toasts.map(\.text) == ["Voting is closed for archived stories."])
        }
    }

    @Test("a reactions batch that raced a vote is dropped")
    func voteEpoch() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            let article = feed.items[3].article
            let staleEpoch = world.states.voteEpoch
            await world.states.vote(article, .up)
            world.states.applyReactions([article.id: .zero], epoch: staleEpoch)
            #expect(world.states.live(article).reactions?.up == 1)
        }
    }

    @Test("save / unsave through the library, the card state follows")
    func saving() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            let first = feed.items[0].article
            let second = feed.items[1].article
            await world.states.toggleSave(first)
            await world.states.toggleSave(second)
            #expect(world.library.articles.map(\.id) == [second.id, first.id], "newest saved first")
            #expect(world.states.live(first).isSaved)
            await world.states.toggleSave(first)
            #expect(!world.states.live(first).isSaved)
            #expect(world.library.articles.map(\.id) == [second.id])

            let reloaded = LibraryModel()
            await reloaded.load()
            #expect(reloaded.articles.map(\.id) == [second.id], "persisted")
        }
    }

    @Test("translate: English into English only nudges; another language uses the server rung")
    func translation() async throws {
        try await world { world in
            let feed = world.feed()
            await feed.reload()
            let article = feed.items[1].article
            await world.states.toggleTranslation(article)
            #expect(world.states.live(article).translation == nil)
            #expect(world.toasts.toasts.map(\.text) == ["Choose a target language other than English first."])
            world.preferences.value.targetLang = "de"
            await world.states.toggleTranslation(article)
            #expect(world.states.live(article).translation?.title == "[de] " + article.title)
            await world.states.toggleTranslation(article)
            #expect(world.states.live(article).translation == nil, "a second tap shows the original")
        }
    }
}
