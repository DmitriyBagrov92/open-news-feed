import ArticleKit
import CoreModels
import Dependencies
import Foundation
import Intelligence
import Networking
import Observation

/// One feed (Today, or a category): the first page, its cards, the local brief and the ambient
/// hues. P1 scope — paging, polling, reactions and translation arrive in P2.
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
    /// LOCAL DIGEST lines (the brief's fallback rung; the on-device model arrives in P7).
    public private(set) var brief: [String] = []
    public private(set) var category: NewsCategory
    /// A category tab (iPad sidebar) shows one category and no chips.
    public let isCategoryLocked: Bool

    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    public init(category: NewsCategory = .all, locked: Bool = false) {
        self.category = category
        self.isCategoryLocked = locked
    }

    public var title: String {
        category == .all ? L10n.t("nav.today") : category.label
    }

    /// First load only; later visits keep what is on screen.
    public func appear() async {
        guard phase == .idle else { return }
        await reload()
    }

    public func reload() async {
        loadTask?.cancel()
        let task = Task { await load() }
        loadTask = task
        await task.value
    }

    public func select(_ next: NewsCategory) {
        guard next != category, !isCategoryLocked else { return }
        category = next
        items = []
        phase = .idle
        Task { await reload() }
    }

    private func load() async {
        if items.isEmpty { phase = .loading }
        do {
            let page = try await api.news(NewsQuery(category: category, pageSize: 30))
            guard !Task.isCancelled else { return }
            items = FeedLayout.items(for: page.articles, withHero: true)
            hues = AmbientPalette.hues(for: items.map(\.article)) ?? hues
            brief = LocalDigest.brief(page.articles.prefix(20).map(DigestItem.init))
            phase = items.isEmpty ? .empty : .loaded
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failed(offline: (error as? APIError)?.isOffline ?? false)
        }
    }
}
