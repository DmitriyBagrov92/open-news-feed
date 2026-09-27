import CoreModels
import Foundation
import Networking

/// A `MeridianAPIClient` that answers from ios/Tests/Fixtures/api the way the Node server in fixture
/// mode would: the captured newsroom filtered, sorted and paged per request; the captured article
/// extractions; in-memory comments and votes. Deterministic and offline — the UI-test mode and
/// the Demo scheme run on it.
public final class FixtureServer: @unchecked Sendable {
    public let capturedAt: Timestamp
    private let english: [Article]
    private let native: [Article]
    private let sourcesResponse: SourcesResponse
    private let battlesResponse: BattlesResponse
    private let bodies: [URL: ArticleBody]
    /// The three "Breaking:" stories of `feed.fresh.json`, found by polls when enabled.
    private let freshStories: [Article]
    private let state = LockedValue(MutableState())

    private struct MutableState {
        var comments: [String: [CoreModels.Comment]] = [:]
        var votes: [String: Reactions] = [:]
        var reported: Set<String> = []
        var nextComment = 1
    }

    /// The reader of the UI-test app: the fixtures' "amber" author (who wrote one captured comment).
    public let me: Persona
    public let myAuthorKey: String

    public init(directory: URL, newStories: Bool = false) throws {
        let api = directory.appendingPathComponent("api")
        func body<T: Decodable>(_ name: String, as type: T.Type) throws -> T {
            let data = try Data(contentsOf: api.appendingPathComponent("\(name).json"))
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            let payload = try JSONSerialization.data(withJSONObject: object?["body"] ?? [:])
            return try JSONDecoder().decode(T.self, from: payload)
        }
        let manifest = try JSONSerialization.jsonObject(with: Data(contentsOf: api.appendingPathComponent("_manifest.json"))) as? [String: Any]
        capturedAt = (manifest?["capturedAt"] as? String).flatMap(Timestamp.init(iso:)) ?? Timestamp(milliseconds: 0)
        english = try body("news-all", as: FeedPage.self).articles
        let mixed = try body("news-all-de", as: FeedPage.self).articles
        native = mixed.filter { $0.language != "en" }
        sourcesResponse = try body("sources", as: SourcesResponse.self)
        freshStories = newStories ? try body("news-new-stories", as: FeedPage.self).articles : []
        battlesResponse = try body("battles", as: BattlesResponse.self)
        var bodies: [URL: ArticleBody] = [:]
        for (slug, name) in [("story-a", "article-story-a"), ("story-b", "article-story-b"), ("story-c", "article-story-c-paywall")] {
            if let article = english.first(where: { $0.url.absoluteString.hasSuffix("/fixture/\(slug)") }) {
                bodies[article.url] = try body(name, as: ArticleBody.self)
            }
        }
        self.bodies = bodies

        // the captured conversation on story-a, as "amber" sees it (their own comment is `mine`)
        let created = try body("comment-created", as: CoreModels.Comment.self)
        me = Persona(name: created.name, avatar: created.avatar)
        myAuthorKey = created.authorKey
        let thread = try body("comments-me", as: CommentsPage.self).comments
        if let storyA = english.first(where: { $0.url.absoluteString.hasSuffix("/fixture/story-a") }) {
            state.update { state in
                state.comments[storyA.id] = thread
                state.votes[storyA.id] = Reactions(comments: thread.count, up: storyA.reactions?.up ?? 0, down: storyA.reactions?.down ?? 0, myVote: nil)
            }
        }
    }

    private static func refusal(_ status: Int, _ code: String, _ message: String) -> APIError {
        .server(status: status, code: code, message: message, retryAfter: nil)
    }

    /// `GET /api/news` semantics (lib/store.js `query`): filters, newest first, 1-based pages.
    public func news(_ query: NewsQuery) -> FeedPage {
        let languages = Set((query.lang ?? "en").split(separator: ",").map(String.init))
        var pool = english + (languages.contains("de") ? native.filter { $0.language == "de" } : [])
        if !languages.contains("en") { pool = pool.filter { languages.contains($0.language) } }
        if query.category != .all { pool = pool.filter { $0.category == query.category.rawValue } }
        if let search = query.search?.trimmingCharacters(in: .whitespaces).lowercased(), !search.isEmpty {
            pool = pool.filter { ($0.title + " " + $0.description).lowercased().contains(search) }
        }
        if !query.exclude.isEmpty { pool = pool.filter { !query.exclude.contains($0.source.id) } }
        if let since = query.since {
            // polls also see the breaking stories that "arrived" after the capture (when enabled)
            pool = (freshStories + pool).filter { $0.publishedAt > since }
        }
        pool.sort { $0.publishedAt > $1.publishedAt }
        let size = min(100, max(1, query.pageSize))
        let start = (max(1, query.page) - 1) * size
        let slice = start < pool.count ? Array(pool[start..<min(pool.count, start + size)]) : []
        let overlay = state.value.votes
        let articles = slice.map { article -> Article in
            var copy = article
            if let reactions = overlay[article.id] { copy.reactions = reactions }
            return copy
        }
        return FeedPage(articles: articles, total: pool.count, page: max(1, query.page), pageSize: size,
                        updatedAt: capturedAt, latestId: pool.first?.id)
    }

    public var client: MeridianAPIClient {
        MeridianAPIClient(
            news: { [self] query in news(query) },
            sources: { [self] in sourcesResponse },
            battles: { [self] in battlesResponse },
            article: { [self] url in
                guard let body = bodies[url] else {
                    throw APIError.server(status: 422, code: "fetch-failed", message: "Upstream returned 404", retryAfter: nil)
                }
                return body
            },
            comments: { [self] query in
                // like the server: one reader's report hides nothing (three do); the app hides it for that reader
                let all = state.value.comments[query.articleID] ?? []
                let sorted = query.sort == .top ? all.stableSorted { ($0.up - $0.down) > ($1.up - $1.down) } : all
                let start = (query.page - 1) * query.pageSize
                let page = start < sorted.count ? Array(sorted[start..<min(sorted.count, start + query.pageSize)]) : []
                return CommentsPage(comments: page, total: all.count, page: query.page, pageSize: query.pageSize, me: me)
            },
            postComment: { [self] articleID, body in
                let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
                guard (2...1000).contains(text.utf16.count) else {
                    throw Self.refusal(400, "bad-body", "Comment must be 2-1000 characters")
                }
                // the server's content screen, reduced to the phrase the fixtures use
                if text.lowercased().contains("kys") {
                    throw Self.refusal(422, "objectionable", "This comment breaks the community rules")
                }
                return state.update { state in
                    let id = String(format: "cc%014x", 0x100 + state.nextComment)
                    state.nextComment += 1
                    let comment = CoreModels.Comment(id: id, name: me.name, avatar: me.avatar, authorKey: myAuthorKey,
                                                     body: text, createdAt: capturedAt, mine: true)
                    state.comments[articleID, default: []].insert(comment, at: 0)
                    var reactions = state.votes[articleID] ?? .zero
                    reactions.comments += 1
                    state.votes[articleID] = reactions
                    return comment
                }
            },
            voteComment: { [self] commentID, value in
                try state.update { state in
                    for (articleID, thread) in state.comments {
                        guard let index = thread.firstIndex(where: { $0.id == commentID }) else { continue }
                        var comment = thread[index]
                        if comment.myVote == .up { comment.up -= 1 }
                        if comment.myVote == .down { comment.down -= 1 }
                        comment.myVote = Vote(rawValue: value)
                        if value == 1 { comment.up += 1 }
                        if value == -1 { comment.down += 1 }
                        state.comments[articleID]?[index] = comment
                        return VoteResult(up: comment.up, down: comment.down, myVote: comment.myVote)
                    }
                    throw Self.refusal(404, "unknown-comment", "No such comment")
                }
            },
            reportComment: { [self] commentID, _ in
                try state.update { state in
                    guard let comment = state.comments.values.joined().first(where: { $0.id == commentID }) else {
                        throw Self.refusal(404, "unknown-comment", "No such comment")
                    }
                    if comment.mine { throw Self.refusal(400, "own-comment", "You cannot report your own comment") }
                    state.reported.insert(commentID) // one reader: never the three that hide it for all
                    return false
                }
            },
            deleteComment: { [self] commentID in
                try state.update { state in
                    for (articleID, thread) in state.comments {
                        guard let comment = thread.first(where: { $0.id == commentID }) else { continue }
                        guard comment.mine else { throw Self.refusal(403, "not-owner", "Only its author can delete a comment") }
                        state.comments[articleID]?.removeAll { $0.id == commentID }
                        var reactions = state.votes[articleID] ?? .zero
                        reactions.comments = max(0, reactions.comments - 1)
                        state.votes[articleID] = reactions
                        return
                    }
                    throw Self.refusal(404, "unknown-comment", "No such comment")
                }
            },
            voteArticle: { [self] articleID, value in
                state.update { state in
                    var reactions = state.votes[articleID] ?? english.first { $0.id == articleID }?.reactions ?? .zero
                    if reactions.myVote == .up { reactions.up -= 1 }
                    if reactions.myVote == .down { reactions.down -= 1 }
                    reactions.myVote = Vote(rawValue: value)
                    if value == 1 { reactions.up += 1 }
                    if value == -1 { reactions.down += 1 }
                    state.votes[articleID] = reactions
                    return VoteResult(up: reactions.up, down: reactions.down, myVote: reactions.myVote)
                }
            },
            reactions: { [self] ids in
                // the counts the feed was served with (the fixtures' zeros, the newsroom's seeded
                // ones) unless this session voted or commented
                let overlay = state.value.votes
                return Dictionary(uniqueKeysWithValues: ids.map { id in
                    (id, overlay[id] ?? english.first { $0.id == id }?.reactions ?? .zero)
                })
            },
            translate: { texts, target, _ in
                TranslateResponse(translations: texts.map { "[\(target)] \($0)" }, provider: "mymemory")
            },
            summarize: { _ in
                throw APIError.server(status: 501, code: "premium-only", message: "Server-side AI summarization is a planned premium feature", retryAfter: nil)
            }
        )
    }
}
