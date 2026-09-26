import ArticleKit
import CoreModels
import DesignSystem
import SwiftUI

/// The search tab (the web's search island): a 300 ms debounce, one character ignored, two or more
/// search the server; the scopes are the categories (the web searches inside the current one).
public struct SearchView: View {
    @Bindable private var store: FeedStore
    @State private var query = ""
    @State private var scope: NewsCategory = .all
    @State private var isSearching = false

    public init(store: FeedStore) {
        self.store = store
    }

    public var body: some View {
        FeedList(store: store) { _ in EmptyView() }
            .overlay {
                if store.search == nil {
                    ContentUnavailableView(L10n.t("search.placeholder"), systemImage: "magnifyingglass",
                                           description: Text(L10n.t("ios.search.hint")))
                        .accessibilityIdentifier("search-idle")
                }
            }
            .navigationTitle(L10n.t("search.open"))
            .searchable(text: $query, isPresented: $isSearching, prompt: L10n.t("search.placeholder"))
            .searchScopes($scope, activation: .onSearchPresentation) {
                ForEach(NewsCategory.allCases) { category in
                    Text(category.label).tag(category)
                }
            }
            // opening the search tab means searching: the field takes focus right away
            .onAppear { isSearching = true }
            .task(id: SearchKey(query: query, scope: scope)) {
                try? await Task.sleep(for: .milliseconds(300))
                guard !Task.isCancelled else { return }
                await store.setSearch(query, in: scope)
            }
    }

    struct SearchKey: Hashable {
        let query: String
        let scope: NewsCategory
    }
}
