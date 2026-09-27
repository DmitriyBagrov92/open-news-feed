import ArticleKit
import CoreModels
import DesignSystem
import GameController
import Intelligence
import Persistence
import SwiftUI

/// How the story is shown: pushed over the feed on compact width (back button, swipe between
/// stories), or as the pane beside the feed on regular width (close button, ‹ › and ←/→).
public enum StoryPresentation {
    case push
    case pane(close: @MainActor () -> Void)

    var isPane: Bool {
        if case .pane = self { return true }
        return false
    }
}

/// The story view (web modal.js `openPreview`): one page per story of the list it was opened from,
/// paged horizontally; the dock acts on the page in view.
public struct StoryPager: View {
    private let route: StoryRoute
    private let presentation: StoryPresentation
    @State private var currentID: String?
    @State private var pool = StoryStorePool()
    /// ←/→ walk the stories (web: the modal owns the arrow keys while open). With a hardware
    /// keyboard the focus system takes arrows before key commands, so the pager keeps the focus and
    /// handles them itself; without it (no focus system) the ‹ › buttons' shortcuts answer.
    @FocusState private var hasKeyboardFocus: Bool
    /// The pager takes the focus only in the iPad pane (the one with ‹ ›; a phone swipes) and only
    /// with a hardware keyboard attached: a focused view makes iOS raise the software keyboard
    /// whenever a menu opens (the comment menus — found in P7).
    @State private var hasHardwareKeyboard = GCKeyboard.coalesced != nil
    @Environment(PreferencesStore.self) private var preferences
    @Environment(ToastCenter.self) private var toasts
    @Environment(ArticleStateStore.self) private var states

    public init(route: StoryRoute, presentation: StoryPresentation) {
        self.route = route
        self.presentation = presentation
        _currentID = State(initialValue: route.articleID)
    }

    private var current: Article {
        route.context.first { $0.id == currentID } ?? route.article ?? route.context[0]
    }

    private func store(for article: Article) -> StoryStore {
        pool.store(for: article, preferences: preferences, toasts: toasts, states: states)
    }

    private func adjacent(_ step: Int) -> Article? {
        guard let index = route.context.firstIndex(where: { $0.id == current.id }) else { return nil }
        let next = index + step
        return route.context.indices.contains(next) ? route.context[next] : nil
    }

    public var body: some View {
        // the pages run edge to edge (the photo under the toolbar, the text under the dock) and
        // inset their own content by the bars measured here
        GeometryReader { proxy in
            let insets = proxy.safeAreaInsets
            ScrollView(.horizontal) {
                LazyHStack(spacing: 0) {
                    ForEach(route.context) { article in
                        StoryPage(store: store(for: article), isPane: presentation.isPane, insets: insets)
                            .containerRelativeFrame(.horizontal)
                            .id(article.id)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.paging)
            .scrollPosition(id: $currentID)
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .vertical)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("story")
        }
        .ignoresSafeArea(edges: .vertical)
        .focusable(presentation.isPane && hasHardwareKeyboard)
        .focused($hasKeyboardFocus)
        .focusEffectDisabled()
        // the focus system may start only with the first key press: be its default then
        .defaultFocus($hasKeyboardFocus, true)
        .onKeyPress(.leftArrow) { go(-1) ? .handled : .ignored }
        .onKeyPress(.rightArrow) { go(1) ? .handled : .ignored }
        .onAppear { hasKeyboardFocus = true }
        .onReceive(NotificationCenter.default.publisher(for: .GCKeyboardDidConnect)) { _ in
            hasHardwareKeyboard = true
            hasKeyboardFocus = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .GCKeyboardDidDisconnect)) { _ in
            hasHardwareKeyboard = GCKeyboard.coalesced != nil
        }
        .background(Color(.systemBackground))
        .toolbarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .toolbar(presentation.isPane ? .automatic : .hidden, for: .tabBar)
        .modifier(PaneDock(isEnabled: presentation.isPane) {
            StoryDock(article: current, store: store(for: current), live: states.live(current))
        })
        .environment(\.openURL, OpenURLAction { url in
            // links in the story open in the in-app browser, http(s) only (BlockText)
            .systemAction(url, prefersInApp: true)
        })
    }

    @discardableResult
    private func go(_ step: Int) -> Bool {
        guard let next = adjacent(step) else { return false }
        withAnimation(.snappy) { currentID = next.id }
        hasKeyboardFocus = true // a tap on ‹ › must not leave the keys with the button
        return true
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        let article = current
        let store = store(for: article)
        let live = states.live(article)

        if case .pane(let close) = presentation {
            ToolbarItem(placement: .topBarLeading) {
                Button(role: .close) { close() }
                    .accessibilityLabel(L10n.t("modal.close"))
                    .accessibilityIdentifier("story-close")
                    .keyboardShortcut(.cancelAction)
            }
            if route.context.count > 1 {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    // the shortcuts answer while the keyboard focus system is off; with it on,
                    // the arrows reach the focused pager's onKeyPress first (see body)
                    Button { go(-1) } label: { Image(systemName: "chevron.left") }
                        .disabled(adjacent(-1) == nil)
                        .keyboardShortcut(.leftArrow, modifiers: [])
                        .accessibilityLabel(L10n.t("modal.prev"))
                        .accessibilityIdentifier("story-prev")
                    Button { go(1) } label: { Image(systemName: "chevron.right") }
                        .disabled(adjacent(1) == nil)
                        .keyboardShortcut(.rightArrow, modifiers: [])
                        .accessibilityLabel(L10n.t("modal.next"))
                        .accessibilityIdentifier("story-next")
                }
                ToolbarSpacer(.fixed, placement: .topBarTrailing)
            }
        }
        ToolbarItemGroup(placement: .topBarTrailing) {
            SaveButton(article: article, live: live)
            ShareButton(article: article)
        }

        if !presentation.isPane {
            // phones: the dock is the system bottom bar (labels collapse to icons, like the web's)
            ToolbarItem(placement: .bottomBar) {
                SummarizeButton(store: store, showsTitle: false)
            }
            ToolbarSpacer(.flexible, placement: .bottomBar)
            ToolbarItemGroup(placement: .bottomBar) {
                TranslateButton(store: store)
                SourceButton(article: article)
            }
            ToolbarSpacer(.fixed, placement: .bottomBar)
            ToolbarItemGroup(placement: .bottomBar) {
                VoteButton(article: article, vote: .up, live: live)
                VoteButton(article: article, vote: .down, live: live)
                CommentsButton(store: store, live: live)
            }
        }
    }
}

// MARK: - Dock

/// The pane's dock: its own glass strip at the bottom of the pane (an inspector column has no
/// glass bottom bar of its own). Labels show where there is room, like the web's wide dock.
private struct PaneDock<Dock: View>: ViewModifier {
    let isEnabled: Bool
    @ViewBuilder let dock: () -> Dock

    func body(content: Content) -> some View {
        if isEnabled {
            content.safeAreaBar(edge: .bottom) {
                dock()
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
        } else {
            content
        }
    }
}

struct StoryDock: View {
    let article: Article
    let store: StoryStore
    let live: ArticleLiveState

    var body: some View {
        GlassEffectContainer(spacing: 10) {
            // "Summarize" spelled out where the pane has room, the sparkle alone where it has not
            ViewThatFits(in: .horizontal) {
                row(showsTitle: true)
                row(showsTitle: false)
            }
        }
    }

    private func row(showsTitle: Bool) -> some View {
        HStack(spacing: 10) {
            SummarizeButton(store: store, showsTitle: showsTitle)
            Spacer(minLength: 0)
            HStack(spacing: 2) {
                TranslateButton(store: store)
                SourceButton(article: article)
            }
            .buttonStyle(DockIconStyle())
            .glassEffect(.regular, in: .capsule)
            HStack(spacing: 2) {
                VoteButton(article: article, vote: .up, live: live)
                VoteButton(article: article, vote: .down, live: live)
                CommentsButton(store: store, live: live)
            }
            .buttonStyle(DockIconStyle())
            .glassEffect(.regular, in: .capsule)
        }
    }
}

/// A dock control inside a glass capsule: 44 pt tall, the label's own shape as hit area.
struct DockIconStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 6)
            .contentShape(Capsule())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

struct SummarizeButton: View {
    let store: StoryStore
    let showsTitle: Bool

    var body: some View {
        Button {
            Task { await store.summarize() }
        } label: {
            Label(L10n.t(store.isSummarizing ? "modal.summarizing" : "modal.summarize"), systemImage: "sparkles")
                .labelStyle(StoryLabelStyle(showsTitle: showsTitle))
        }
        .buttonStyle(.glassProminent)
        .tint(Tokens.Palette.ai)
        .disabled(store.isSummarizing)
        .accessibilityLabel(L10n.t(store.isSummarizing ? "modal.summarizing" : "modal.summarize"))
        .accessibilityIdentifier("story-summarize")
    }
}

struct TranslateButton: View {
    let store: StoryStore

    var body: some View {
        let showing = store.showsTranslation
        Button {
            if showing { store.toggleVersion() } else { Task { await store.translate() } }
        } label: {
            if store.isTranslating {
                ProgressView()
            } else {
                Image(systemName: showing ? "globe.badge.chevron.backward" : "globe")
            }
        }
        .accessibilityLabel(L10n.t(store.isTranslating ? "modal.translating" : showing ? "card.showOriginal" : "modal.translate"))
        .accessibilityIdentifier("story-translate")
    }
}

struct SourceButton: View {
    let article: Article
    @Environment(\.cardActions) private var actions

    var body: some View {
        Button {
            actions.openOriginal(article)
        } label: {
            Image(systemName: "safari")
        }
        .accessibilityLabel(L10n.t("card.open"))
        .accessibilityIdentifier("story-source")
    }
}

struct VoteButton: View {
    let article: Article
    let vote: Vote
    let live: ArticleLiveState
    @Environment(ArticleStateStore.self) private var states

    var body: some View {
        let reactions = live.reactions ?? .zero
        let count = vote == .up ? reactions.up : reactions.down
        let pressed = reactions.myVote == vote
        Button {
            Task { await states.vote(article, vote) }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: vote == .up ? "arrow.up" : "arrow.down")
                Text("\(count)").monospacedDigit()
            }
            .fontWeight(.semibold)
            .foregroundStyle(pressed ? Color.accentColor : Color.primary)
        }
        .accessibilityLabel(L10n.t(vote == .up ? "card.like" : "card.dislike"))
        .accessibilityValue(String(count))
        .accessibilityAddTraits(pressed ? .isSelected : [])
        .accessibilityIdentifier(vote == .up ? "story-up" : "story-down")
        .sensoryFeedback(.selection, trigger: pressed)
    }
}

/// 💬 with the count: scrolls the story to its comments (web `preview-comments`).
struct CommentsButton: View {
    let store: StoryStore
    let live: ArticleLiveState

    var body: some View {
        let count = live.reactions?.comments ?? store.comments.total
        Button {
            store.showComments()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "bubble.left")
                if count > 0 { Text("\(count)").monospacedDigit() }
            }
            .fontWeight(.semibold)
        }
        .accessibilityLabel(L10n.t("ios.comments.open"))
        .accessibilityValue(String(count))
        .accessibilityIdentifier("story-comments")
    }
}

struct SaveButton: View {
    let article: Article
    let live: ArticleLiveState
    @Environment(ArticleStateStore.self) private var states

    var body: some View {
        Button {
            Task { await states.toggleSave(article) }
        } label: {
            Image(systemName: live.isSaved ? "bookmark.fill" : "bookmark")
        }
        .accessibilityLabel(L10n.t(live.isSaved ? "card.unsave" : "card.save"))
        .accessibilityIdentifier("story-save")
    }
}

struct ShareButton: View {
    let article: Article

    var body: some View {
        ShareLink(item: article.url, subject: Text(article.title), message: Text(article.title)) {
            Image(systemName: "square.and.arrow.up")
        }
        .accessibilityLabel(L10n.t("card.share"))
        .accessibilityIdentifier("story-share")
    }
}

/// Title and icon where there is room, the icon alone on phones (the title stays the
/// accessibility label either way).
struct StoryLabelStyle: LabelStyle {
    let showsTitle: Bool

    func makeBody(configuration: Configuration) -> some View {
        if showsTitle {
            HStack(spacing: 6) {
                configuration.icon
                configuration.title
            }
            .font(.body.weight(.semibold))
            .padding(.horizontal, 4)
            .frame(minHeight: 32)
        } else {
            configuration.icon
        }
    }
}

// MARK: - Page

/// One story: hero, byline, title, key points, text (web `.modal-article`).
struct StoryPage: View {
    let store: StoryStore
    let isPane: Bool
    /// The bars around the pager (it lays pages out under them).
    let insets: EdgeInsets

    private var article: Article { store.article }

    static let commentsAnchor = "comments"

    var body: some View {
        GeometryReader { geometry in
            let hasPhoto = article.image != nil
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if hasPhoto {
                            StoryHero(article: article)
                                .frame(height: heroHeight(geometry.size.height))
                        }
                        StoryBody(store: store, isPane: isPane)
                            .padding(.top, hasPhoto ? (isPane ? -56 : -64) : insets.top + 12)
                    }
                    .frame(maxWidth: .infinity)
                }
                .contentMargins(.bottom, insets.bottom + 16, for: .scrollContent)
                .contentMargins(.top, insets.top, for: .scrollIndicators)
                .contentMargins(.bottom, insets.bottom, for: .scrollIndicators)
                .ignoresSafeArea(edges: .vertical)
                .onChange(of: store.commentsScrollRequest) {
                    withAnimation(.snappy) { proxy.scrollTo(Self.commentsAnchor, anchor: .top) }
                }
            }
        }
        .task { await store.load() }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("story-\(article.id)")
    }

    /// web `.modal-media`: min(52vh, 480) but at least 280; 300 in the pane.
    private func heroHeight(_ height: CGFloat) -> CGFloat {
        if isPane { return 300 }
        return max(280, min(height * 0.52, 480))
    }
}

/// The photo, darkened at the top for the toolbar and melting into the page at the bottom.
struct StoryHero: View {
    let article: Article

    var body: some View {
        RemoteImage(url: article.image) {
            SourceTile(sourceID: article.source.id, sourceName: article.source.name, letterScale: 0.36, letterOffset: -0.3)
        }
        .overlay {
            LinearGradient(
                stops: [
                    .init(color: .black.opacity(0.25), location: 0),
                    .init(color: .clear, location: 0.3),
                    .init(color: .clear, location: 0.45),
                    .init(color: Color(.systemBackground), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
        }
        .clipped()
    }
}

struct StoryBody: View {
    let store: StoryStore
    let isPane: Bool
    @Environment(\.provenanceRegistry) private var registry

    private var article: Article { store.article }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            meta
            Text(store.displayedTitle)
                .heavyTitle(isPane ? 26 : 30, relativeTo: .largeTitle)
                .tracking(-0.6)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("story-\(article.id)-title")
            if store.translation != nil {
                Button {
                    withAnimation(.smooth) { store.toggleVersion() }
                } label: {
                    Text(L10n.t(store.showsTranslation ? "modal.chipTranslated" : "modal.chipOriginal"))
                        .captionVoice(.primary)
                }
                .buttonStyle(.glass)
                .controlSize(.small)
                .accessibilityIdentifier("story-chip")
            }
            if let summary = store.summary {
                SummaryBox(summary: summary)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
            if case .fallback = store.body {
                Text(L10n.t("modal.unavailable"))
                    .font(.subheadline.italic())
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("story-note")
            }
            if store.body == .loading {
                TextSkeleton()
            } else {
                StoryBlocks(blocks: store.displayedBlocks)
                    .accessibilityIdentifier("story-\(article.id)-text")
            }
            CommentsSection(store: store.comments)
                .id(StoryPage.commentsAnchor)
        }
        .animation(.smooth, value: store.summary)
        .animation(.smooth, value: store.showsTranslation)
        .padding(.horizontal, isPane ? 28 : 20)
        .padding(.bottom, 32)
        .frame(maxWidth: 720, alignment: .leading)
        .frame(maxWidth: .infinity)
    }

    /// Flag · source · absolute time · category (web `.modal-meta`).
    private var meta: some View {
        let provenance = article.source.provenance.resolved(sourceID: article.source.id, registry: registry)
        let rest = [RelativeTime.absTime(article.publishedAt), NewsCategory.label(for: article.category)].filter { !$0.isEmpty }.joined(separator: " · ")
        // one line while it fits; with large text the date moves under the outlet instead of
        // both being cut short
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 6) {
                FlagView(provenance, size: 15)
                Text(article.source.name).captionVoice(.primary).fixedSize()
                if !rest.isEmpty {
                    Text(rest).captionVoice(.secondary).fixedSize()
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    FlagView(provenance, size: 15)
                    Text(article.source.name).captionVoice(.primary)
                }
                if !rest.isEmpty {
                    Text(rest).captionVoice(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// KEY POINTS with the provider badge (web `.modal-summary`).
struct SummaryBox: View {
    let summary: StoryStore.Summary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles").font(.system(size: 13, weight: .bold))
                Text(L10n.t("modal.summaryTitle")).captionVoice(Tokens.Palette.ai)
                Badge(TextKit.providerLabel(summary.provider), tint: Tokens.Palette.ai)
            }
            .foregroundStyle(Tokens.Palette.ai)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(summary.bullets.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Circle()
                            .fill(Tokens.Palette.ai)
                            .frame(width: 5, height: 5)
                            .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                        Text(line).font(.subheadline.weight(.medium))
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular.tint(Tokens.Palette.ai.opacity(0.12)), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("story-summary")
    }
}

/// The structured text (web `renderBlocks`): the lede a size up, headings one level below the
/// title, quotes with the indigo rule, lists with indigo markers, links in the tint colour.
struct StoryBlocks: View {
    let blocks: [ArticleBlock]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                BlockView(block: block, isLede: index == 0)
            }
        }
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct BlockView: View {
    let block: ArticleBlock
    let isLede: Bool

    var body: some View {
        switch block {
        case .paragraph(let runs):
            Text(BlockText.attributed(runs))
                .font(isLede ? .title3.weight(.medium) : .body)
                .lineSpacing(isLede ? 4 : 6)
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let runs):
            Text(BlockText.attributed(runs))
                .font(level <= 2 ? .title3.weight(.heavy) : .headline.weight(.heavy))
                .padding(.top, 6)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
        case .quote(let runs):
            Text(BlockText.attributed(runs))
                .font(.body.italic())
                .lineSpacing(6)
                .foregroundStyle(.secondary)
                .padding(.leading, 14)
                .overlay(alignment: .leading) {
                    Rectangle().fill(Tokens.Palette.ai).frame(width: 2)
                }
                .fixedSize(horizontal: false, vertical: true)
        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, runs in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(ordered ? "\(index + 1)." : "•")
                            .monospacedDigit()
                            .foregroundStyle(Tokens.Palette.ai)
                            .accessibilityHidden(!ordered) // a bullet is layout; a number is content
                        Text(BlockText.attributed(runs))
                            .lineSpacing(6)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .font(.body)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// Five lines while the text is extracted (web `.skel-text`).
struct TextSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach([0, 24, 48, 12, 140], id: \.self) { shortfall in
                HStack(spacing: 0) {
                    Capsule().fill(.fill.tertiary).frame(height: 13)
                    Spacer(minLength: CGFloat(shortfall))
                }
            }
        }
        .accessibilityHidden(true)
        .accessibilityIdentifier("story-skeleton")
    }
}
