import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Networking
import Persistence
import StoryFeature
import Testing
import TestSupport

/// A story's conversation (web comments.js) on the fixture newsroom: story-a carries the three
/// captured comments, the reader is the fixtures' "amber" author (Solar Jetty), one of them theirs.
@MainActor
@Suite("Comments on the fixture newsroom", .serialized)
struct CommentsIntegrationTests {
    private let storyA = "825452304de0"

    @MainActor
    struct World {
        let server: FixtureServer
        let preferences: PreferencesStore
        let toasts: ToastCenter
        let states: ArticleStateStore
        let article: Article
        let reported = ReportedComments()

        func comments() -> CommentsStore {
            CommentsStore(article: article, preferences: preferences, toasts: toasts, states: states, reported: reported)
        }
    }

    private func world(_ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root)
        try await withDependencies {
            $0.meridianAPI = server.client
            $0.date = .constant(server.capturedAt.date)
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
        } operation: {
            let preferences = PreferencesStore()
            let library = LibraryModel()
            let toasts = ToastCenter()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts)
            let article = try #require(server.news(NewsQuery(pageSize: 100)).articles.first { $0.id == storyA })
            try await body(World(server: server, preferences: preferences, toasts: toasts, states: states, article: article))
        }
    }

    @Test("the conversation loads with the reader's persona, and its count reaches the story's cards")
    func load() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            #expect(store.phase == .loaded)
            #expect(store.comments.count == 3 && store.total == 3 && !store.hasMore)
            #expect(store.me?.name == "Solar Jetty")
            #expect(store.comments.filter(\.mine).count == 1)
            #expect(world.states.live(world.article).reactions?.comments == 3)
            await store.setSort(.top)
            #expect(store.comments.first?.up == 2, "Top: the best-liked first")
        }
    }

    @Test("posting: the rules once, 2–1000 characters, prepended as the reader's own, counts follow")
    func post() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            #expect(store.needsRulesAcceptance)
            store.acceptRules()
            #expect(!store.needsRulesAcceptance && world.preferences.value.commentRulesAccepted)
            store.draft = " x "
            #expect(!store.canPost, "one character after trimming")
            store.draft = String(repeating: "é", count: 1001)
            #expect(!store.canPost)
            store.draft = "  A fair point about the ferries.  "
            #expect(store.canPost)
            #expect(await store.post())
            #expect(store.draft.isEmpty)
            #expect(store.comments.first?.body == "A fair point about the ferries.")
            #expect(store.comments.first?.mine == true)
            #expect(store.total == 4 && world.states.live(world.article).reactions?.comments == 4)
        }
    }

    @Test("the server's refusals become the web's messages")
    func refusals() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            store.draft = "kys, all of you"
            #expect(await store.post() == false)
            #expect(store.draft == "kys, all of you", "the draft survives a refusal")
            #expect(world.toasts.toasts.map(\.text) == ["This comment breaks the community rules."])
            let refusal = { (code: String) in APIError.server(status: 400, code: code, message: "", retryAfter: nil) }
            #expect(CommentsStore.postFailureKey(refusal("too-fast")) == "comments.tooFast")
            #expect(CommentsStore.postFailureKey(refusal("banned")) == "comments.banned")
            #expect(CommentsStore.postFailureKey(refusal("comments-full")) == "comments.limit")
            #expect(CommentsStore.postFailureKey(APIError.network(.notConnectedToInternet)) == "comments.failed")
        }
    }

    @Test("votes use the server's counts; a second tap retracts")
    func votes() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            let target = try #require(store.comments.first { $0.up == 0 && $0.myVote == nil })
            await store.vote(target, .up)
            let voted = try #require(store.comments.first { $0.id == target.id })
            #expect(voted.up == 1 && voted.myVote == .up)
            await store.vote(voted, .up)
            let retracted = try #require(store.comments.first { $0.id == target.id })
            #expect(retracted.up == 0 && retracted.myVote == nil)
        }
    }

    @Test("a report hides the comment for this reader, also when the story opens again")
    func report() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            let target = try #require(store.comments.first { !$0.mine })
            await store.report(target, reason: .spam)
            #expect(!store.comments.contains { $0.id == target.id })
            #expect(world.toasts.toasts.map(\.text) == ["Thanks — the comment was reported and hidden for you."])
            let reopened = world.comments()
            await reopened.loadIfNeeded()
            #expect(!reopened.comments.contains { $0.id == target.id })
            #expect(reopened.comments.count == 2)
        }
    }

    @Test("blocking hides every comment by that commenter and is remembered")
    func block() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            let target = try #require(store.comments.first { !$0.mine })
            store.block(target)
            #expect(!store.comments.contains { $0.authorKey == target.authorKey })
            #expect(world.preferences.value.blockedAuthors == [BlockedAuthor(key: target.authorKey, name: target.name)])
            #expect(world.toasts.toasts.map(\.text) == ["You won’t see comments from \(target.name)."])
            let reopened = world.comments()
            await reopened.loadIfNeeded()
            #expect(!reopened.comments.contains { $0.authorKey == target.authorKey })
        }
    }

    @Test("readers delete their own comments only")
    func delete() async throws {
        try await world { world in
            let store = world.comments()
            await store.loadIfNeeded()
            let mine = try #require(store.comments.first { $0.mine })
            let theirs = try #require(store.comments.first { !$0.mine })
            await store.delete(theirs)
            #expect(store.comments.contains { $0.id == theirs.id })
            #expect(world.toasts.toasts.last?.text == "That did not work. Try again.")
            await store.delete(mine)
            #expect(!store.comments.contains { $0.id == mine.id })
            #expect(store.total == 2 && world.states.live(world.article).reactions?.comments == 2)
        }
    }

    @Test("pages of 20: more loads the rest without duplicates")
    func paging() async throws {
        try await world { world in
            for index in 0..<18 {
                _ = try await world.server.client.postComment(world.article.id, "Take number \(index)")
            }
            let store = world.comments()
            await store.loadIfNeeded()
            #expect(store.comments.count == 20 && store.total == 21 && store.hasMore)
            await store.loadMore()
            #expect(store.comments.count == 21 && !store.hasMore)
            #expect(Set(store.comments.map(\.id)).count == 21)
        }
    }
}
