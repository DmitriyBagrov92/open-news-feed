import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Networking
import Observation
import Persistence

/// Comments reported this session: hidden for the reporter at once and whenever the story is
/// opened again (the server hides a comment for everyone only at three reports).
@MainActor
public final class ReportedComments {
    public static let shared = ReportedComments()
    public private(set) var ids: Set<String> = []

    public init() {}

    func insert(_ id: String) {
        ids.insert(id)
    }
}

/// One story's conversation (web comments.js `buildCommentsPanel`): pages of 20, New / Top, the
/// composer, votes, and the moderation a reader has — report, block, delete their own.
@MainActor
@Observable
public final class CommentsStore {
    public enum Sort: String, Sendable, CaseIterable, Identifiable {
        case new, top
        public var id: String { rawValue }
        public var label: String { L10n.t(self == .new ? "comments.sortNew" : "comments.sortTop") }
    }

    public enum Phase: Equatable, Sendable {
        case idle, loading, loaded, empty, failed
    }

    public static let pageSize = 20
    public static let bodyLimits = 2...1000

    public let article: Article
    /// What the reader sees: blocked commenters and comments they reported are left out.
    public private(set) var comments: [CoreModels.Comment] = []
    /// The server's count of visible comments.
    public private(set) var total = 0
    public private(set) var phase: Phase = .idle
    public private(set) var hasMore = false
    public private(set) var isLoading = false
    public private(set) var me: Persona?
    public private(set) var isPosting = false
    public private(set) var sort: Sort = .new
    /// The composer's text: kept while the story view lives (web: drafts survive prev/next).
    public var draft = ""

    @ObservationIgnored private var page = 1
    @ObservationIgnored private var seen: Set<String> = []
    @ObservationIgnored private let preferences: PreferencesStore?
    @ObservationIgnored private let toasts: ToastCenter?
    @ObservationIgnored private let states: ArticleStateStore?
    @ObservationIgnored private let reported: ReportedComments
    @ObservationIgnored @Dependency(\.meridianAPI) private var api

    public init(article: Article, preferences: PreferencesStore?, toasts: ToastCenter?, states: ArticleStateStore?,
                reported: ReportedComments = .shared) {
        self.article = article
        self.preferences = preferences
        self.toasts = toasts
        self.states = states
        self.reported = reported
    }

    /// The trimmed draft is 2–1000 UTF-16 units (the server's rule).
    public var canPost: Bool {
        !isPosting && Self.bodyLimits.contains(draft.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)
    }

    public var needsRulesAcceptance: Bool {
        preferences?.value.commentRulesAccepted != true
    }

    public func acceptRules() {
        preferences?.value.commentRulesAccepted = true
    }

    // MARK: Loading

    /// First appearance of the section: page 1 once.
    public func loadIfNeeded() async {
        guard phase == .idle else { return }
        await load(reset: true)
    }

    public func reload() async {
        await load(reset: true)
    }

    public func loadMore() async {
        guard hasMore else { return }
        await load(reset: false)
    }

    public func setSort(_ next: Sort) async {
        guard next != sort else { return }
        sort = next
        await load(reset: true)
    }

    private func load(reset: Bool) async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        if reset {
            page = 1
            seen = []
            if phase != .loaded { phase = .loading }
        }
        do {
            let result = try await api.comments(CommentsQuery(
                articleID: article.id, page: page, pageSize: Self.pageSize, sort: sort == .top ? .top : .new
            ))
            if reset { comments = [] }
            setTotal(result.total)
            if let persona = result.me { me = persona }
            for comment in result.comments where seen.insert(comment.id).inserted {
                if isHidden(comment) { continue }
                comments.append(comment)
            }
            page += 1
            hasMore = seen.count < result.total
            phase = result.total == 0 ? .empty : .loaded
        } catch {
            if comments.isEmpty {
                phase = .failed
            } else {
                toasts?.show(L10n.t("comments.error"))
            }
        }
    }

    private func isHidden(_ comment: CoreModels.Comment) -> Bool {
        reported.ids.contains(comment.id) || preferences?.value.isBlocked(comment.authorKey) == true
    }

    /// The total also drives the 💬 count on the story's cards (web `onCountChange`).
    private func setTotal(_ value: Int) {
        total = value
        guard let states else { return }
        let live = states.live(article)
        var reactions = live.reactions ?? .zero
        if reactions.comments != value {
            reactions.comments = value
            live.reactions = reactions
        }
    }

    // MARK: Posting

    /// → true once posted (the composer closes). Errors are the web's toasts.
    @discardableResult
    public func post() async -> Bool {
        let body = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canPost else { return false }
        isPosting = true
        defer { isPosting = false }
        do {
            let created = try await api.postComment(article.id, body)
            draft = ""
            me = Persona(name: created.name, avatar: created.avatar)
            if seen.insert(created.id).inserted { comments.insert(created, at: 0) }
            setTotal(total + 1)
            phase = .loaded
            return true
        } catch {
            toasts?.show(L10n.t(Self.postFailureKey(error)))
            return false
        }
    }

    /// web `errorCodeToast`.
    public static func postFailureKey(_ error: Error) -> String {
        switch (error as? APIError)?.code {
        case "too-fast": "comments.tooFast"
        case "duplicate": "comments.duplicate"
        case "article-limit", "comments-full": "comments.limit"
        case "unknown-article": "comments.closed"
        case "objectionable": "comments.objectionable"
        case "banned": "comments.banned"
        default: "comments.failed"
        }
    }

    // MARK: Votes

    /// Like / dislike; a second tap retracts. The server's counts are the truth.
    public func vote(_ comment: CoreModels.Comment, _ vote: Vote) async {
        let next = comment.myVote == vote ? 0 : vote.rawValue
        do {
            let result = try await api.voteComment(comment.id, next)
            guard let index = comments.firstIndex(where: { $0.id == comment.id }) else { return }
            comments[index].up = result.up
            comments[index].down = result.down
            comments[index].myVote = result.myVote
        } catch {
            toasts?.show(L10n.t(Self.postFailureKey(error)))
        }
    }

    // MARK: Moderation

    public func report(_ comment: CoreModels.Comment, reason: ReportReason) async {
        do {
            _ = try await api.reportComment(comment.id, reason)
            reported.insert(comment.id)
            drop { $0.id == comment.id }
            toasts?.show(L10n.t("comments.reported"))
        } catch {
            toasts?.show(L10n.t("comments.actionFailed"))
        }
    }

    /// Hides every comment by this commenter on this device (Settings lists them to unblock).
    public func block(_ comment: CoreModels.Comment) {
        guard !comment.authorKey.isEmpty else { return }
        preferences?.value.block(comment.authorKey, name: comment.name)
        drop { $0.authorKey == comment.authorKey }
        toasts?.show(L10n.t("comments.blocked", ["name": comment.name]))
    }

    public func delete(_ comment: CoreModels.Comment) async {
        do {
            try await api.deleteComment(comment.id)
            drop { $0.id == comment.id }
            setTotal(max(0, total - 1))
            if total == 0 { phase = .empty }
            toasts?.show(L10n.t("comments.deleted"))
        } catch {
            toasts?.show(L10n.t("comments.actionFailed"))
        }
    }

    private func drop(where match: (CoreModels.Comment) -> Bool) {
        comments.removeAll(where: match)
    }
}
