import ArticleKit
import CoreModels
import DesignSystem
import Persistence
import SwiftUI

/// The Saved tab (web Your Feed › Saved): bookmarks and onboarding likes, newest first, the story
/// as it was when saved — works offline. Local search (web: case-insensitive title + description),
/// swipe right to remove.
public struct SavedView: View {
    @Environment(LibraryModel.self) private var library
    @Environment(\.cardSizing) private var sizing
    @State private var query = ""

    public init() {}

    public var body: some View {
        let filtered = filter(library.articles)
        let items = FeedLayout.items(for: filtered, withHero: true)
        GeometryReader { geometry in
            let columns = FeedLayout.columns(forWidth: geometry.size.width, cardMin: sizing.cardMin)
            let gutter: CGFloat = columns == 1 ? Tokens.Space.page : 24
            ScrollView {
                LazyVStack(spacing: 0) {
                    if !library.isLoaded {
                        ForEach(0..<4, id: \.self) { _ in SkeletonRow().padding(.horizontal, gutter) }
                    } else if items.isEmpty {
                        if query.trimmingCharacters(in: .whitespaces).count >= 2 {
                            ContentUnavailableView(L10n.t("feed.emptySearch", ["q": query]), systemImage: "magnifyingglass",
                                                   description: Text(L10n.t("feed.emptySearchHint")))
                                .padding(.top, 40)
                        } else {
                            ContentUnavailableView(L10n.t("feed.emptySaved"), systemImage: "bookmark",
                                                   description: Text(L10n.t("feed.emptySavedHint")))
                                .padding(.top, 60)
                                .accessibilityIdentifier("empty-saved")
                        }
                    } else {
                        ForEach(FeedLayout.blocks(items, columns: columns)) { block in
                            FeedBlockView(block: block, columns: columns, width: geometry.size.width, gutter: gutter)
                                .id(block.id)
                        }
                    }
                }
                .padding(.bottom, 24)
                .animation(.snappy, value: library.articles.map(\.id))
            }
        }
        .background { AmbientBackground(hues: AmbientPalette.hues(for: library.articles) ?? AmbientPalette.defaults) }
        .navigationTitle(L10n.t("nav.saved"))
        .searchable(text: $query, prompt: L10n.t("search.placeholder"))
        .task { if !library.isLoaded { await library.load() } }
    }

    private func filter(_ articles: [Article]) -> [Article] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard needle.count >= 2 else { return articles }
        return articles.filter { ($0.title + " " + $0.description).localizedCaseInsensitiveContains(needle) }
    }
}
