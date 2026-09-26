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
/// behind the pill, counters refreshed for what is on screen, the brief, the ambient hues.
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
    /// The BRIEF of the stories in view (web `runBrief`): up to 7 key points.
    public private(set) var brief: [String] = []
    /// Who wrote it: "on-device" (Apple Intelligence), a server provider, or "local" (the digest).
    public private(set) var briefProvider = "local"
    /// A run is pending or in flight: the card shows its thinking bars.
    public private(set) var isBriefThinking = false
    /// The view could not be loaded, so there is nothing to summarize (web `brief.error`).
    public private(set) var isBriefFailed = false
    /// Off screen or in the background the brief waits (web: `document.hidden` defers it).
    @ObservationIgnored public var isOnScreen = true {
        didSet {
            if isOnScreen, !oldValue, briefDeferred { scheduleBrief(after: .seconds(2)) }
        }
    }
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
    @ObservationIgnored private var briefTask: Task<Void, Never>?
    @ObservationIgnored private var briefGeneration = 0
    @ObservationIgnored private var briefDeferred = false

    @ObservationIgnored private let preferences: PreferencesStore
    @ObservationIgnored private let sources: SourcesModel
    @ObservationIgnored private let states: ArticleStateStore
    @ObservationIgnored private let toasts: ToastCenter
    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored @Dependency(\.date) private var date
    @ObservationIgnored @Dependency(\.continuousClock) private var clock
    @ObservationIgnored @Dependency(\.polling) private var polling
    @ObservationIgnored @Dependency(\.summarizer) private var summarizer
    @ObservationIgnored @Dependency(\.translator) private var translator

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
        // the brief belongs to the view: thinking at once, the run once the stories are in (web
        // clearPending); a run still busy with the previous view is dropped
        if !isSearch {
            briefTask?.cancel()
            briefGeneration += 1
            isBriefThinking = true
        }
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
            scheduleBrief(after: .milliseconds(300))
        } catch is CancellationError {
            return
        } catch {
            guard current == generation else { return }
            phase = .failed(offline: (error as? APIError)?.isOffline ?? false)
            briefTask?.cancel()
            isBriefThinking = false
            if items.isEmpty {
                brief = []
                isBriefFailed = !isSearch
            }
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
        scheduleBrief(after: .milliseconds(800)) // fresh stories just landed — re-summarize them
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
        hues = AmbientPalette.hues(for: items.map(\.article)) ?? hues
    }

    /// What the forecast of this view is cached under (web `viewKey`): the view, the hidden
    /// sources, the language and the newest story — news that lands makes a new forecast due.
    public var forecastKey: String {
        [category.rawValue, search ?? "", preferences.value.hiddenSources.joined(separator: ","),
         preferences.value.targetLang, newestAt.map { String($0.milliseconds) } ?? ""].joined(separator: "|")
    }

    /// The reader's language (translation target, AI output).
    public var targetLanguage: String { preferences.value.targetLang }

    /// The view's stories newest first — the brief's and the forecast's pool (the web asks the
    /// server for the first page), not the mosaic order with its hoisted hero.
    public var newestFirst: [Article] {
        items.map(\.article).enumerated()
            .sorted { $0.element.publishedAt != $1.element.publishedAt ? $0.element.publishedAt > $1.element.publishedAt : $0.offset < $1.offset }
            .map(\.element)
    }

    // MARK: Brief

    /// Debounced (web `scheduleBrief`): the thinking state shows at once, the run follows —
    /// 300 ms after a load, 800 ms after new stories, 400 ms after a language change, 0 for the
    /// refresh button, 2 s after coming back.
    public func scheduleBrief(after delay: Duration) {
        guard !isSearch else { return }
        isBriefThinking = true
        briefTask?.cancel()
        briefTask = Task { [weak self, clock] in
            if delay > .zero { try? await clock.sleep(for: delay) }
            guard !Task.isCancelled else { return }
            await self?.runBrief()
        }
    }

    /// The language changed: the brief follows it.
    public func languageChanged() {
        guard phase == .loaded || phase == .empty else { return }
        scheduleBrief(after: .milliseconds(400))
    }

    /// The summarize ladder over the 20 freshest stories in view; the local digest quotes English
    /// headlines, so its lines go through the translate ladder for another reader language.
    public func runBrief() async {
        guard isOnScreen else {
            // summarizing costs battery — wait for the reader; nobody sees the thinking bars meanwhile
            // (a forever-repeating animation under a pushed story would keep the app from idling)
            briefDeferred = true
            isBriefThinking = false
            return
        }
        briefDeferred = false
        briefGeneration += 1
        let current = briefGeneration
        let pool = Array(newestFirst.prefix(20))
        guard !pool.isEmpty else {
            brief = []
            briefProvider = "local"
            isBriefThinking = false
            return
        }
        let target = preferences.value.targetLang
        let topic = category == .all ? "" : category.label
        let result = await summarizer.brief(pool.map(DigestItem.init), topic, target)
        guard current == briefGeneration else { return }
        var lines = TextKit.toBullets(result.summary, max: 7)
        if target != "en", result.provider == "local",
           let translated = await translator.translate(lines, target, "en", false), translated.texts.count == lines.count {
            guard current == briefGeneration else { return }
            lines = translated.texts
        }
        brief = lines
        briefProvider = result.provider
        isBriefThinking = false
        isBriefFailed = false
    }
}

extension FeedStore: StoryListSource {
    public var storyList: [Article] { items.map(\.article) }
}
