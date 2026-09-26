import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Observation
import Persistence

/// One feed — Today, a category, or search results (web `loadFeed` / `pollNew` /
/// `refreshReactions`, app.js:349-696): pages of 30 without duplicates, new stories buffered
/// behind the pill, counters refreshed for what is on screen, the local brief, the ambient hues.
@MainActor
@Observable
public final class FeedStore {
    public enum Phase: Equatable {
        case idle, loading, loaded, empty
        case failed(offline: Bool)
    }

    public private(set) var items: [FeedItem] = []
    public private(set) var phase: Phase = .idle
    public private(set) var hues: [Int] = AmbientPalette.defaults
    /// LOCAL DIGEST lines (the on-device model joins in P7).
    public private(set) var brief: [String] = []
    public private(set) var category: NewsCategory
    /// The query in search mode (≥ 2 characters), else `nil`.
    public private(set) var search: String?
    public private(set) var hasMore = false
    public private(set) var isLoadingMore = false
    /// New stories found by the poll, newest first, waiting for the pill.
    public private(set) var pending: [Article] = []
    /// Stories just prepended — highlighted for 2.6 s.
    public private(set) var fresh: Set<String> = []
    /// Set by seeking (time chip / rail): the view scrolls there and clears it.
    public var scrollTarget: String?

    public let isCategoryLocked: Bool
    public let isSearch: Bool

    /// Article ids in view, top first (fed by the view's visibility tracking).
    @ObservationIgnored public var visibleIDs: [String] = [] {
        didSet { if visibleIDs.first != oldValue.first { topVisibleID = visibleIDs.first } }
    }
    public private(set) var topVisibleID: String?

    @ObservationIgnored private var page = 1
    @ObservationIgnored private var newestAt: Timestamp?
    @ObservationIgnored private var shown: Set<String> = []
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var loadMoreFailures = 0
    @ObservationIgnored private var retryAfter: Date?
    @ObservationIgnored private var freshTask: Task<Void, Never>?

    @ObservationIgnored private let preferences: PreferencesStore
    @ObservationIgnored private let sources: SourcesModel
    @ObservationIgnored private let states: ArticleStateStore
    @ObservationIgnored private let toasts: ToastCenter
    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored @Dependency(\.date) private var date
    @ObservationIgnored @Dependency(\.continuousClock) private var clock
    @ObservationIgnored @Dependency(\.polling) private var polling

    public init(category: NewsCategory = .all, locked: Bool = false, search: Bool = false,
                preferences: PreferencesStore, sources: SourcesModel, states: ArticleStateStore, toasts: ToastCenter) {
        self.category = category
        self.isCategoryLocked = locked
        self.isSearch = search
        self.preferences = preferences
        self.sources = sources
        self.states = states
        self.toasts = toasts
    }

    public var title: String {
        category == .all ? L10n.t("nav.today") : category.label
    }

    public var timescale: Timescale? {
        Timescale(times: items.map(\.article.publishedAt.milliseconds))
    }

    // MARK: Loading

    /// First load only; later visits keep what is on screen.
    public func appear() async {
        guard phase == .idle, !isSearch || search != nil else { return }
        await reload()
    }

    public func select(_ next: NewsCategory) {
        guard next != category, !isCategoryLocked else { return }
        category = next
        restart()
    }

    /// Search mode: ≥ 2 characters search, empty clears, 1 character is ignored (web app.js:841-883).
    public func setSearch(_ text: String, in scope: NewsCategory) async {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if query.count == 1 { return }
        let next = query.isEmpty ? nil : query
        guard next != search || scope != category else { return }
        search = next
        category = scope
        generation += 1
        items = []
        pending = []
        phase = .idle
        guard next != nil else { return }
        await reload()
    }

    /// A setting that changes the query (hidden sources, language) invalidates what is shown.
    public func invalidate() {
        guard phase != .idle else { return }
        restart()
    }

    private func restart() {
        items = []
        pending = []
        phase = .idle
        Task { await reload() }
    }

    public func reload() async {
        generation += 1
        let current = generation
        page = 1
        hasMore = false
        pending = []
        loadMoreFailures = 0
        retryAfter = nil
        if items.isEmpty { phase = .loading }
        do {
            let result = try await api.news(query(page: 1))
            guard current == generation else { return }
            let visible = visibleArticles(result.articles)
            items = FeedLayout.items(for: visible, withHero: true)
            shown = Set(items.map(\.id))
            newestAt = result.articles.first?.publishedAt
            hasMore = result.page * result.pageSize < result.total
            page = 2
            feedCounters(visible)
            repaint()
            phase = items.isEmpty ? .empty : .loaded
        } catch is CancellationError {
            return
        } catch {
            guard current == generation else { return }
            phase = .failed(offline: (error as? APIError)?.isOffline ?? false)
        }
    }

    /// The next page, when the reader nears the end. Failures back off exponentially (2 s … 60 s)
    /// with one toast — the web retried in a tight loop.
    public func loadMore() async {
        guard hasMore, !isLoadingMore, phase == .loaded else { return }
        if let retryAfter, date.now < retryAfter { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let current = generation
        do {
            let result = try await api.news(query(page: page))
            guard current == generation else { return }
            let added = FeedLayout.items(for: visibleArticles(result.articles), withHero: false, excluding: shown)
            items += added
            shown.formUnion(added.map(\.id))
            hasMore = result.page * result.pageSize < result.total
            page += 1
            loadMoreFailures = 0
            retryAfter = nil
            feedCounters(added.map(\.article))
            repaint()
        } catch {
            guard current == generation else { return }
            loadMoreFailures += 1
            retryAfter = date.now.addingTimeInterval(min(60, pow(2, Double(loadMoreFailures))))
            if loadMoreFailures == 1 { toasts.show(L10n.t("feed.loadMoreError")) }
        }
    }

    // MARK: Polling

    /// The 30 s tick while the feed is on screen, the app is active and online: new stories,
    /// then counters. `quickStart` takes the short first tick used when coming back.
    public func poll(quickStart: Bool) async {
        var first = true
        while !Task.isCancelled {
            try? await clock.sleep(for: first && quickStart ? polling.resumeDelay : polling.interval)
            first = false
            guard !Task.isCancelled else { return }
            await pollNew()
            await refreshReactions()
        }
    }

    /// `since=newestAt&pageSize=100` → unseen, visible stories join the pending buffer.
    public func pollNew() async {
        guard phase == .loaded, let since = newestAt, !isLoadingMore else { return }
        let current = generation
        guard let result = try? await api.news(query(page: 1, pageSize: 100, since: since)), current == generation else { return }
        let waiting = Set(pending.map(\.id))
        let found = visibleArticles(result.articles).filter { !shown.contains($0.id) && !waiting.contains($0.id) }
        if !found.isEmpty { pending = found + pending }
    }

    /// The pill: prepend the buffer (rows only), remember the newest, glow for 2.6 s.
    public func showPending() {
        let added = FeedLayout.prependItems(pending, excluding: shown)
        if let newest = pending.first?.publishedAt { newestAt = newest }
        pending = []
        guard !added.isEmpty else { return }
        items = added + items
        shown.formUnion(added.map(\.id))
        feedCounters(added.map(\.article))
        repaint()
        fresh = Set(added.map(\.id))
        freshTask?.cancel()
        freshTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.6))
            guard !Task.isCancelled else { return }
            self?.fresh = []
        }
    }

    /// `GET /api/reactions` for what is on screen first (≤ 150 ids), dropped if a vote raced it.
    public func refreshReactions() async {
        let ids = reactionIDs()
        guard !ids.isEmpty else { return }
        let epoch = states.voteEpoch
        guard let reactions = try? await api.reactions(ids) else { return }
        states.applyReactions(reactions, epoch: epoch)
    }

    func reactionIDs(limit: Int = 150) -> [String] {
        var ordered: [String] = []
        var seen: Set<String> = []
        for id in visibleIDs + items.map(\.id) where ArticleID.isValid(id) && seen.insert(id).inserted {
            ordered.append(id)
            if ordered.count == limit { break }
        }
        return ordered
    }

    // MARK: Seeking

    /// Scroll to the story at `fraction` of the loaded time range (0 = newest), loading one more
    /// page when the target is older than everything loaded.
    public func seek(to fraction: Double) async {
        guard let scale = timescale else { return }
        if let index = scale.index(atFraction: fraction) {
            scrollTarget = items[index].id
        } else if hasMore {
            await loadMore()
            if let scale = timescale, let index = scale.index(atFraction: fraction) {
                scrollTarget = items[index].id
            }
        } else if let last = items.last {
            scrollTarget = last.id
        }
    }

    // MARK: Helpers

    private func query(page: Int, pageSize: Int = 30, since: Timestamp? = nil) -> NewsQuery {
        NewsQuery(
            category: category,
            search: search,
            exclude: preferences.value.hiddenSources,
            lang: Language.feedQuery(target: preferences.value.targetLang, nativeLanguages: sources.nativeLanguages),
            page: page,
            pageSize: pageSize,
            since: since
        )
    }

    /// The server already excludes hidden sources; the device filters again (web `visibleArticles`).
    private func visibleArticles(_ articles: [Article]) -> [Article] {
        let hidden = Set(preferences.value.hiddenSources)
        return hidden.isEmpty ? articles : articles.filter { !hidden.contains($0.source.id) }
    }

    /// Counters that arrived with a page update the shared live state.
    private func feedCounters(_ articles: [Article]) {
        var reactions: [String: Reactions] = [:]
        for article in articles {
            if let value = article.reactions { reactions[article.id] = value }
            _ = states.live(article)
        }
        states.applyReactions(reactions, epoch: states.voteEpoch)
    }

    private func repaint() {
        let articles = items.map(\.article)
        hues = AmbientPalette.hues(for: articles) ?? hues
        // the brief's pool is newest first (the web asks the server for pageSize=20), not the
        // mosaic order with its hoisted hero
        let newestFirst = articles.enumerated()
            .sorted { $0.element.publishedAt != $1.element.publishedAt ? $0.element.publishedAt > $1.element.publishedAt : $0.offset < $1.offset }
            .map(\.element)
        brief = LocalDigest.brief(newestFirst.prefix(20).map(DigestItem.init))
    }
}
