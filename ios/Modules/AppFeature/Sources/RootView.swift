import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import FeedFeature
import Observation
import SwiftUI

/// Where the app is. One `TabView` adapts to both size classes: a floating tab bar with a search
/// island on iPhone, a sidebar (with the categories) on iPad and wide windows.
public enum AppTab: Hashable, Sendable {
    case today, yourFeed, battle, saved, search
    case category(NewsCategory)
}

@MainActor
@Observable
public final class AppRouter {
    public var tab: AppTab = .today

    public init(tab: AppTab = .today) {
        self.tab = tab
    }
}

/// "Now" for every dateline, ticking every 30 s (web `refreshTimes`); pinned in UI tests.
@MainActor
@Observable
public final class AppClock {
    public private(set) var now: Int64
    @ObservationIgnored @Dependency(\.date) private var date
    @ObservationIgnored @Dependency(\.continuousClock) private var clock

    public init() {
        @Dependency(\.date) var date
        now = Int64(date.now.timeIntervalSince1970 * 1000)
    }

    public func run() async {
        while !Task.isCancelled {
            try? await clock.sleep(for: .seconds(30))
            now = Int64(date.now.timeIntervalSince1970 * 1000)
        }
    }
}

public struct RootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var router: AppRouter
    @State private var clock = AppClock()
    @State private var today = FeedStore(category: .all)
    @State private var categoryStores: [NewsCategory: FeedStore] = Dictionary(
        uniqueKeysWithValues: NewsCategory.feed.map { ($0, FeedStore(category: $0, locked: true)) }
    )

    public init(initialTab: AppTab = .today) {
        _router = State(initialValue: AppRouter(tab: initialTab))
    }

    public var body: some View {
        TabView(selection: $router.tab) {
            Tab(L10n.t("nav.today"), systemImage: "newspaper", value: AppTab.today) {
                NavigationStack { TodayView(store: today).toolbar { toolbar } }
            }
            .accessibilityIdentifier("tab-today")

            Tab(L10n.t("cat.saved"), systemImage: "person.crop.circle", value: AppTab.yourFeed) {
                NavigationStack { Placeholder(title: L10n.t("cat.saved"), symbol: "person.crop.circle", text: L10n.t("ios.soon.yourFeed")) }
            }

            Tab(L10n.t("nav.battle"), systemImage: "bubbles.and.sparkles", value: AppTab.battle) {
                NavigationStack { Placeholder(title: L10n.t("cat.battle"), symbol: "bubbles.and.sparkles", text: L10n.t("ios.soon.battle")) }
            }

            Tab(L10n.t("nav.saved"), systemImage: "bookmark", value: AppTab.saved) {
                NavigationStack { Placeholder(title: L10n.t("nav.saved"), symbol: "bookmark", text: L10n.t("ios.soon.saved")) }
            }

            if horizontalSizeClass == .regular {
                // iPad / wide windows: the categories live in the sidebar (on iPhone they are chips)
                TabSection(L10n.t("ios.sidebar.categories")) {
                    ForEach(NewsCategory.feed) { category in
                        Tab(category.label, systemImage: category.symbol, value: AppTab.category(category)) {
                            NavigationStack {
                                TodayView(store: categoryStores[category] ?? FeedStore(category: category, locked: true))
                                    .toolbar { toolbar }
                            }
                        }
                    }
                }
                .defaultVisibility(.hidden, for: .tabBar)
            }

            Tab(value: AppTab.search, role: .search) {
                NavigationStack { Placeholder(title: L10n.t("search.open"), symbol: "magnifyingglass", text: L10n.t("ios.soon.search")) }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .onChange(of: horizontalSizeClass) { _, size in
            // a category tab only exists in the sidebar: fold it into Today when the window goes compact
            if size == .compact, case .category(let category) = router.tab {
                today.select(category)
                router.tab = .today
            }
        }
        .environment(\.clockNow, clock.now)
        .task { await clock.run() }
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                // P7: the Ahead forecast (shown only where Apple Intelligence is available)
            } label: {
                Image(systemName: "sparkles")
            }
            .tint(Tokens.Palette.ai)
            .accessibilityLabel(L10n.t("ios.ahead.open"))
        }
        ToolbarSpacer(.fixed, placement: .topBarTrailing)
        ToolbarItemGroup(placement: .topBarTrailing) {
            Menu {
                ForEach(Language.all) { language in
                    Button(language.name) {}
                }
            } label: {
                Image(systemName: "globe")
            }
            .accessibilityLabel(L10n.t("lang.title"))
            Button {
                // P10: Settings
            } label: {
                Image(systemName: "gearshape")
            }
            .accessibilityLabel(L10n.t("settings.open"))
        }
    }
}

/// Temporary stand-in for tabs built in later phases.
struct Placeholder: View {
    let title: String
    let symbol: String
    let text: String

    var body: some View {
        ContentUnavailableView(L10n.t("ios.soon.title"), systemImage: symbol, description: Text(text))
            .navigationTitle(title)
            .background { AmbientBackground(hues: AmbientPalette.defaults) }
    }
}
