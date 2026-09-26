import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Networking
import Observation
import Persistence

/// The live, mutable side of one story — counters, saved flag, translation — shared by every
/// surface that shows it (feed card, Saved, search results, later the story view and Battle).
/// Replaces the web's "mirror the result onto the grid card" plumbing.
@MainActor
@Observable
public final class ArticleLiveState {
    public var reactions: Reactions?
    public var isSaved = false
    public var translation: Translation?
    public var isTranslating = false

    public struct Translation: Hashable, Sendable {
        public let language: String
        public let title: String
        public let description: String
    }

    init(reactions: Reactions?, isSaved: Bool) {
        self.reactions = reactions
        self.isSaved = isSaved
    }
}

/// Owns every `ArticleLiveState` and the actions on them. One instance per app.
@MainActor
@Observable
public final class ArticleStateStore {
    @ObservationIgnored private var states: [String: ArticleLiveState] = [:]
    @ObservationIgnored private var votesInFlight: Set<String> = []
    /// Bumped around every vote so a reactions batch that was in flight while a vote changed
    /// counters is dropped rather than undoing the vote (web `voteEpoch`).
    @ObservationIgnored public private(set) var voteEpoch = 0

    @ObservationIgnored private let library: LibraryModel
    @ObservationIgnored private let preferences: PreferencesStore
    @ObservationIgnored private let toasts: ToastCenter
    @ObservationIgnored @Dependency(\.meridianAPI) private var api

    public init(library: LibraryModel, preferences: PreferencesStore, toasts: ToastCenter) {
        self.library = library
        self.preferences = preferences
        self.toasts = toasts
    }

    /// The live state for a story, created from the story's own counters the first time.
    public func live(_ article: Article) -> ArticleLiveState {
        if let state = states[article.id] {
            if state.reactions == nil, let reactions = article.reactions { state.reactions = reactions }
            return state
        }
        let state = ArticleLiveState(reactions: article.reactions, isSaved: library.contains(article.id))
        states[article.id] = state
        return state
    }

    /// Counters from `GET /api/reactions` (or a feed page), unless a vote happened meanwhile.
    public func applyReactions(_ reactions: [String: Reactions], epoch: Int) {
        guard epoch == voteEpoch else { return }
        for (id, value) in reactions {
            guard let state = states[id], !votesInFlight.contains(id) else { continue }
            if state.reactions != value { state.reactions = value }
        }
    }

    /// Like / dislike (web app.js:163-191): optimistic, a second tap retracts, one request per
    /// story at a time, rolled back with a toast when the server says no.
    public func vote(_ article: Article, _ vote: Vote) async {
        let state = live(article)
        guard !votesInFlight.contains(article.id) else { return }
        votesInFlight.insert(article.id)
        voteEpoch += 1
        defer {
            votesInFlight.remove(article.id)
            voteEpoch += 1
        }
        let previous = state.reactions ?? .zero
        let next: Vote? = previous.myVote == vote ? nil : vote
        state.reactions = Self.optimistic(previous, next)
        do {
            let result = try await api.voteArticle(article.id, next?.rawValue ?? 0)
            state.reactions = Reactions(comments: previous.comments, up: result.up, down: result.down, myVote: result.myVote)
        } catch {
            state.reactions = previous
            toasts.show(L10n.t((error as? APIError)?.code == "unknown-article" ? "card.voteClosed" : "card.voteFailed"))
        }
    }

    static func optimistic(_ previous: Reactions, _ next: Vote?) -> Reactions {
        var value = previous
        if previous.myVote == .up { value.up -= 1 }
        if previous.myVote == .down { value.down -= 1 }
        if next == .up { value.up += 1 }
        if next == .down { value.down += 1 }
        value.myVote = next
        value.up = max(0, value.up)
        value.down = max(0, value.down)
        return value
    }

    /// Save / unsave the story as it is right now (with its live counters).
    public func toggleSave(_ article: Article) async {
        let state = live(article)
        var snapshot = article
        snapshot.reactions = state.reactions ?? article.reactions
        state.isSaved.toggle()
        let saved = await library.toggle(snapshot)
        state.isSaved = saved
    }

    /// Translate / show the original (web card translate). P2 uses the server rung; the full
    /// ladder (on-device first) replaces it in P6.
    public func toggleTranslation(_ article: Article) async {
        let state = live(article)
        if state.translation != nil {
            state.translation = nil
            return
        }
        let target = preferences.value.targetLang
        guard target != article.language else {
            toasts.show(L10n.t("lang.pick"))
            return
        }
        state.isTranslating = true
        defer { state.isTranslating = false }
        do {
            let response = try await api.translate([article.title, article.description], target, article.language)
            guard response.translations.count == 2 else { throw APIError.decoding("translation count") }
            state.translation = .init(language: target, title: response.translations[0], description: response.translations[1])
        } catch {
            toasts.show(L10n.t("lang.unavailable"))
        }
    }

    /// Keeps saved flags right after the library changes elsewhere (e.g. the Saved tab).
    public func syncSaved() {
        for (id, state) in states {
            let saved = library.contains(id)
            if state.isSaved != saved { state.isSaved = saved }
        }
    }
}
