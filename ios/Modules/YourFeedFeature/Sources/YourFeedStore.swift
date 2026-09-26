import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Observation
import Persistence

/// Your Feed (web `renderYourFeed`, app.js:405-580): until five stories are rated, a taste
/// onboarding deck — like or skip one story at a time; then the stories ranked for the reader,
/// with "Tune more" for another round. The profile never leaves the device.
@MainActor
@Observable
public final class YourFeedStore {
    public enum Phase: Equatable {
        case idle
        case onboarding
        case loading
        case recommended
        case failed(offline: Bool)
    }

    public enum Deck: Equatable {
        case loading
        case ready
        /// Nothing unseen to rate (web `onboard.empty`).
        case empty
        case failed
    }

    public private(set) var phase: Phase = .idle
    // onboarding
    public private(set) var deck: Deck = .loading
    /// The story on stage.
    public private(set) var card: Article?
    public private(set) var batchDone = 0
    public private(set) var batchTotal = TasteEngine.batch
    // recommended
    public private(set) var recommended: [Article] = []
    public private(set) var hues: [Int] = AmbientPalette.defaults

    @ObservationIgnored private var candidates: [Article] = []
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loadedAt: Date?

    @ObservationIgnored private let preferences: PreferencesStore
    @ObservationIgnored private let library: LibraryModel
    @ObservationIgnored private let sources: SourcesModel
    @ObservationIgnored private let states: ArticleStateStore
    @ObservationIgnored private let toasts: ToastCenter
    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored @Dependency(\.date) private var date

    /// The ranking is redone when the reader comes back after this long (saves and the news move on).
    static let staleAfter: TimeInterval = 5 * 60

    public init(preferences: PreferencesStore, library: LibraryModel, sources: SourcesModel,
                states: ArticleStateStore, toasts: ToastCenter) {
        self.preferences = preferences
        self.library = library
        self.sources = sources
        self.states = states
        self.toasts = toasts
    }

    /// Fewer than five ratings: the deck comes first (web `taste.count < ONBOARD_BATCH`).
    public var needsOnboarding: Bool { preferences.value.taste.count < TasteEngine.batch }

    public func appear() async {
        switch phase {
        case .idle, .failed:
            await reload()
        case .recommended:
            if let loadedAt, date.now.timeIntervalSince(loadedAt) > Self.staleAfter { await loadRecommended() }
        case .onboarding, .loading:
            break
        }
    }

    public func reload() async {
        if needsOnboarding {
            await startOnboarding()
        } else {
            await loadRecommended()
        }
    }

    /// A setting that changes the pool (hidden sources, language) invalidates what is shown.
    public func invalidate() {
        guard phase == .recommended || phase == .loading else { return }
        phase = .idle
        Task { await reload() }
    }

    // MARK: Onboarding

    /// A round of five (web `enterOnboarding`): diverse, unseen candidates from the 100 newest.
    /// "Tune more" starts another one.
    public func startOnboarding() async {
        generation += 1
        let current = generation
        phase = .onboarding
        deck = .loading
        card = nil
        batchDone = 0
        batchTotal = TasteEngine.batch
        do {
            let pool = try await pool()
            guard current == generation else { return }
            candidates = TasteEngine.onboardingCandidates(pool, taste: preferences.value.taste, saved: library.ids)
            deck = candidates.isEmpty ? .empty : .ready
            next()
        } catch is CancellationError {
            return
        } catch {
            guard current == generation else { return }
            deck = .failed
        }
    }

    /// Rates the story on stage (web `onRate`): the profile learns, a like is a save (never an
    /// unsave), the story's global counters move — best effort.
    public func rate(_ dir: Int) {
        guard phase == .onboarding, let article = card else { return }
        var taste = preferences.value.taste
        TasteEngine.apply(&taste, article, dir: dir)
        preferences.value.taste = taste
        if dir == 1, !library.contains(article.id) {
            Task { [states] in await states.toggleSave(article) }
        }
        Task { [states] in await states.rate(article, dir == 1 ? .up : .down) }
        batchDone += 1
        if batchDone >= batchTotal {
            finish()
        } else {
            next()
        }
    }

    private func next() {
        guard !candidates.isEmpty else {
            // the deck ran dry before the round was done — finish with what there is
            card = nil
            if deck == .ready { finish() }
            return
        }
        let article = candidates.removeFirst()
        card = article
        states.autoTranslate(article) // the staged story follows the translation setting (web)
    }

    private func finish() {
        card = nil
        if needsOnboarding {
            Task { await startOnboarding() }
        } else {
            toasts.show(L10n.t("onboard.done"))
            Task { await loadRecommended() }
        }
    }

    // MARK: Recommended

    /// web `renderRecommended`: the 100 newest ranked by the profile; when nothing scores above
    /// bare freshness the reader is told so.
    public func loadRecommended() async {
        generation += 1
        let current = generation
        if recommended.isEmpty { phase = .loading }
        do {
            let pool = try await pool()
            guard current == generation else { return }
            let now = Int64(date.now.timeIntervalSince1970 * 1000)
            let ranking = TasteEngine.rank(pool, taste: preferences.value.taste, saved: library.ids, now: now)
            recommended = ranking.articles
            hues = AmbientPalette.hues(for: ranking.articles) ?? hues
            loadedAt = date.now
            phase = .recommended
            for article in ranking.articles { _ = states.live(article) }
            if !ranking.personalized, !ranking.articles.isEmpty { toasts.show(L10n.t("feed.recoFallback")) }
        } catch is CancellationError {
            return
        } catch {
            guard current == generation else { return }
            if recommended.isEmpty {
                phase = .failed(offline: (error as? APIError)?.isOffline ?? false)
            } else {
                toasts.show(L10n.t("feed.loadMoreError"))
                phase = .recommended
            }
        }
    }

    // MARK: Helpers

    /// The pool: every category, hidden sources out, the reader's language mixed in (web
    /// `buildParams({ pageSize: 100 })` on the Your Feed tab).
    private func pool() async throws -> [Article] {
        let query = NewsQuery(
            category: .all,
            exclude: preferences.value.hiddenSources,
            lang: Language.feedQuery(target: preferences.value.targetLang, nativeLanguages: sources.nativeLanguages),
            page: 1,
            pageSize: 100
        )
        let result = try await api.news(query)
        let hidden = Set(preferences.value.hiddenSources)
        var reactions: [String: Reactions] = [:]
        for article in result.articles {
            if let value = article.reactions { reactions[article.id] = value }
        }
        states.applyReactions(reactions, epoch: states.voteEpoch)
        return hidden.isEmpty ? result.articles : result.articles.filter { !hidden.contains($0.source.id) }
    }
}

extension YourFeedStore: StoryListSource {
    public var storyList: [Article] { recommended }
}
