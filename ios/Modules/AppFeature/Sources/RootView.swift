import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import FeedFeature
import Networking
import Observation
import Persistence
import StoryFeature
import SwiftUI
import YourFeedFeature

/// Where the app is. One `TabView` adapts to both size classes: a floating tab bar with a search
/// island on iPhone, a sidebar (with the categories) on iPad and wide windows.
public enum AppTab: Hashable, Sendable {
    case today, yourFeed, battle, saved, search
    case category(NewsCategory)

    /// Persisted main tabs (category tabs fold into Today).
    var storageKey: String? {
        switch self {
        case .today: "today"
        case .yourFeed: "yourFeed"
        case .battle: "battle"
        case .saved: "saved"
        case .search, .category: nil
        }
    }

    init?(storageKey: String?) {
        switch storageKey {
        case "today": self = .today
        case "yourFeed": self = .yourFeed
        case "battle": self = .battle
        case "saved": self = .saved
        default: return nil
        }
    }
}

@MainActor
@Observable
public final class AppRouter {
    public var tab: AppTab
    /// Compact width: the story pushed on each tab's stack.
    public var paths: [AppTab: [StoryRoute]] = [:]
    /// Regular width: the story in the pane beside each tab's feed.
    public var panes: [AppTab: StoryRoute] = [:]

    public init(tab: AppTab = .today) {
        self.tab = tab
    }

    public func open(_ route: StoryRoute, on tab: AppTab, regular: Bool) {
        if regular {
            panes[tab] = route
        } else {
            paths[tab] = [route]
        }
    }

    /// The window changed size class: the pane becomes a pushed story, and back.
    public func adapt(regular: Bool) {
        if regular {
            for (tab, path) in paths {
                if let route = path.last { panes[tab] = route }
            }
            paths = [:]
        } else {
            for (tab, route) in panes { paths[tab] = [route] }
            panes = [:]
        }
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

/// The app-wide objects, created once and shared through the environment.
@MainActor
final class AppModel {
    let preferences = PreferencesStore()
    let library = LibraryModel()
    let toasts = ToastCenter()
    let sources = SourcesModel()
    let connectivity = ConnectivityModel()
    let clock = AppClock()
    let states: ArticleStateStore
    let today: FeedStore
    let search: FeedStore
    let categories: [NewsCategory: FeedStore]

    init() {
        states = ArticleStateStore(library: library, preferences: preferences, toasts: toasts)
        let initial = NewsCategory(rawValue: preferences.value.category) ?? .all
        today = FeedStore(category: initial, preferences: preferences, sources: sources, states: states, toasts: toasts)
        search = FeedStore(search: true, preferences: preferences, sources: sources, states: states, toasts: toasts)
        let (preferences, sources, states, toasts) = (preferences, sources, states, toasts)
        categories = Dictionary(uniqueKeysWithValues: NewsCategory.feed.map {
            ($0, FeedStore(category: $0, locked: true, preferences: preferences, sources: sources, states: states, toasts: toasts))
        })
    }

    var feeds: [FeedStore] { [today, search] + Array(categories.values) }
}

public struct RootView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.openURL) private var openURL
    @State private var model = AppModel()
    @State private var router: AppRouter
    private let initialStoryID: String?

    /// - Parameter initialRoute: UI tests / screenshots (`LaunchContract.Env.initialRoute`):
    ///   `today`, `saved`, `search` or `story/<articleID>` (a Today story, opened once it loads).
    public init(initialRoute: String? = nil) {
        let parts = (initialRoute ?? "").split(separator: "/", maxSplits: 1).map(String.init)
        let tab: AppTab = switch parts.first {
        case "saved": .saved
        case "search": .search
        default: .today
        }
        _router = State(initialValue: AppRouter(tab: tab))
        initialStoryID = parts.first == "story" && parts.count == 2 ? parts[1] : nil
    }

    public var body: some View {
        let model = model
        let preferences = model.preferences
        tabs
            .modifier(TimeAccessory(
                // the chip belongs to the feed: not over a pushed story's dock
                isEnabled: router.tab == .today && horizontalSizeClass != .regular && (router.paths[.today] ?? []).isEmpty,
                store: model.today
            ))
            .overlay(alignment: .bottom) {
                ToastOverlay().padding(.bottom, horizontalSizeClass == .regular ? 32 : 104)
            }
            .environment(model.preferences)
            .environment(model.library)
            .environment(model.toasts)
            .environment(model.sources)
            .environment(model.connectivity)
            .environment(model.states)
            .environment(\.clockNow, model.clock.now)
            .environment(\.provenanceRegistry, model.sources.registry)
            .environment(\.cardSizing, CardSizing(level: preferences.value.gridSize))
            .environment(\.cardActions, cardActions)
            .task { await model.clock.run() }
            .task { await model.connectivity.run() }
            .task { await model.sources.load() }
            .task {
                await model.library.load()
                model.states.syncSaved()
            }
            .task { await openInitialStory() }
            .onAppear {
                guard initialStoryID == nil else { return }
                if let saved = AppTab(storageKey: preferences.value.lastTab), router.tab == .today { router.tab = saved }
            }
            .onChange(of: router.tab) { _, tab in
                if let key = tab.storageKey { model.preferences.value.lastTab = key }
            }
            .onChange(of: model.today.category) { _, category in
                model.preferences.value.category = category.rawValue
            }
            .onChange(of: preferences.value.targetLang) { _, _ in
                model.states.languageChanged()
                // the language decides the `lang` parameter when it has native feeds (web setLanguage)
                if !model.sources.nativeLanguages.isEmpty { model.feeds.forEach { $0.invalidate() } }
            }
            .onChange(of: preferences.value.autoTranslate) { _, _ in
                model.states.autoTranslateChanged()
            }
            .onChange(of: preferences.value.hiddenSources) { _, _ in
                model.feeds.forEach { $0.invalidate() }
            }
            .onChange(of: model.sources.nativeLanguages) { _, _ in
                // native feeds for the chosen language became known: the `lang` parameter changes
                if preferences.value.targetLang != "en" { model.feeds.forEach { $0.invalidate() } }
            }
            .onChange(of: horizontalSizeClass) { _, size in
                router.adapt(regular: size == .regular)
                // a category tab only exists in the sidebar: fold it into Today when the window goes compact
                if size == .compact, case .category(let category) = router.tab {
                    model.today.select(category)
                    router.tab = .today
                }
            }
    }

    private var tabs: some View {
        TabView(selection: $router.tab) {
            Tab(L10n.t("nav.today"), systemImage: "newspaper", value: AppTab.today) {
                StoryStack(.today, router: router) { TodayView(store: model.today).toolbar { toolbar } }
            }

            Tab(L10n.t("cat.saved"), systemImage: "person.crop.circle", value: AppTab.yourFeed) {
                NavigationStack { Placeholder(title: L10n.t("cat.saved"), symbol: "person.crop.circle", text: L10n.t("ios.soon.yourFeed")) }
            }

            Tab(L10n.t("nav.battle"), systemImage: "bubbles.and.sparkles", value: AppTab.battle) {
                NavigationStack { Placeholder(title: L10n.t("cat.battle"), symbol: "bubbles.and.sparkles", text: L10n.t("ios.soon.battle")) }
            }

            Tab(L10n.t("nav.saved"), systemImage: "bookmark", value: AppTab.saved) {
                StoryStack(.saved, router: router) { SavedView().toolbar { toolbar } }
            }

            if horizontalSizeClass == .regular {
                TabSection(L10n.t("ios.sidebar.categories")) {
                    ForEach(NewsCategory.feed) { category in
                        Tab(category.label, systemImage: category.symbol, value: AppTab.category(category)) {
                            StoryStack(.category(category), router: router) {
                                if let store = model.categories[category] {
                                    TodayView(store: store).toolbar { toolbar }
                                }
                            }
                        }
                    }
                }
                .defaultVisibility(.hidden, for: .tabBar)
            }

            Tab(value: AppTab.search, role: .search) {
                StoryStack(.search, router: router) { SearchView(store: model.search) }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
    }

    private func openInitialStory() async {
        guard let id = initialStoryID else { return }
        for _ in 0..<200 {
            let articles = model.today.items.map(\.article)
            if let article = articles.first(where: { $0.id == id }) {
                router.open(StoryRoute(article: article, context: articles), on: .today, regular: horizontalSizeClass == .regular)
                return
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
    }

    /// The original article opens in the in-app browser (stories open through `openStory`).
    private var cardActions: CardActions {
        var actions = CardActions(id: "app")
        let open = openURL
        actions.openOriginal = { article in open(article.url, prefersInApp: true) }
        return actions
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
            LanguageMenu()
            Button {
                // P10: Settings
            } label: {
                Image(systemName: "gearshape")
            }
            .accessibilityLabel(L10n.t("settings.open"))
        }
    }
}

/// The globe: THE language (translation target, AI output) and auto-translate (web popover,
/// index.html:146-162, `setLanguage` app.js:915-938).
struct LanguageMenu: View {
    @Environment(PreferencesStore.self) private var preferences

    var body: some View {
        @Bindable var preferences = preferences
        Menu {
            Picker(L10n.t("lang.target"), selection: Binding(
                get: { preferences.value.targetLang },
                set: { next in
                    guard next != preferences.value.targetLang else { return }
                    preferences.value.targetLang = next
                    // picking a language counts as asking for translation (web)
                    if next != "en" { preferences.value.autoTranslate = true }
                }
            )) {
                ForEach(Language.all) { language in
                    Text(language.name).tag(language.code)
                }
            }
            Toggle(L10n.t("lang.auto"), isOn: $preferences.value.autoTranslate)
        } label: {
            Image(systemName: "globe")
        }
        .accessibilityLabel(L10n.t("lang.title"))
        .accessibilityIdentifier("language-menu")
    }
}

/// The time chip in the tab bar's bottom accessory (iOS 26.1+ can switch it off per tab).
struct TimeAccessory: ViewModifier {
    let isEnabled: Bool
    let store: FeedStore

    func body(content: Content) -> some View {
        if #available(iOS 26.1, *) {
            content.tabViewBottomAccessory(isEnabled: isEnabled) { TimeChip(store: store) }
        } else {
            content
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
