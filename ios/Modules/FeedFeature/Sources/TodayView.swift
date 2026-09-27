import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Intelligence
import Networking
import Persistence
import SwiftUI

/// Today (or one category): world clocks, the brief, then the freshest-first mosaic — photos as
/// the material, Liquid Glass only on the controls floating above them.
public struct TodayView: View {
    @Bindable private var store: FeedStore
    @Environment(\.clockNow) private var now
    @Environment(ConnectivityModel.self) private var connectivity: ConnectivityModel?
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var isVisible = false

    public init(store: FeedStore) {
        self.store = store
    }

    private var isOnline: Bool { connectivity?.isOnline ?? true }

    public var body: some View {
        FeedList(store: store, showsRail: sizeClass == .regular) { columns in
            if !store.isCategoryLocked {
                CategoryChips(selected: store.category) { store.select($0) }
                    .padding(.bottom, 10)
            }
            WorldClocks(compact: columns == 1)
                .padding(.horizontal, FeedMetrics.gutter(columns))
                .padding(.top, 2)
                .padding(.bottom, 12)
            BriefCard(lines: store.brief, provider: store.briefProvider, isThinking: store.isBriefThinking,
                      failed: store.isBriefFailed) {
                store.scheduleBrief(after: .zero)
            }
            .padding(.horizontal, FeedMetrics.gutter(columns))
            .padding(.bottom, 6)
        }
        .overlay(alignment: .top) {
            VStack(spacing: 8) {
                if !isOnline {
                    GlassBanner(L10n.t("feed.offline"), systemImage: "wifi.slash")
                        .accessibilityIdentifier("offline-banner")
                }
                if !store.pending.isEmpty {
                    NewStoriesPill(count: store.pending.count) { store.showPending() }
                }
            }
            // below the category chips at rest, floating under the bar once the chips scroll away
            .padding(.top, store.isCategoryLocked ? 8 : 58)
            .animation(.spring(response: 0.4, dampingFraction: 0.75), value: store.pending.count)
            .animation(.snappy, value: isOnline)
        }
        .navigationTitle(store.title)
        .navigationSubtitle(Self.dateline(now))
        .onAppear {
            isVisible = true
            // like the web's `document.hidden`: only the background hides the feed
            store.isOnScreen = scenePhase != .background
        }
        .onDisappear {
            isVisible = false
            store.isOnScreen = false
        }
        .onChange(of: scenePhase) { _, phase in
            store.isOnScreen = phase != .background && isVisible
        }
        .task { await store.appear() }
        .task(id: PollGate(active: scenePhase == .active, online: isOnline, visible: isVisible)) {
            guard scenePhase == .active, isOnline, isVisible else { return }
            await store.poll(quickStart: store.phase == .loaded)
        }
        .onChange(of: isOnline) { _, online in
            // back online with nothing on screen: try again (web `online` handler)
            if online, store.items.isEmpty { Task { await store.reload() } }
        }
    }

    struct PollGate: Hashable {
        let active: Bool
        let online: Bool
        let visible: Bool
    }

    /// "Saturday, 26 September" — the web's `#feedDate` (device locale), recomputed with the clock
    /// so it rolls over at midnight.
    static func dateline(_ now: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(now) / 1000)
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
}

enum FeedMetrics {
    /// Side margin: the phone gutter on one column, wider on the mosaic.
    static func gutter(_ columns: Int) -> CGFloat { columns == 1 ? Tokens.Space.page : 24 }
}

/// The scrolling feed shared by Today, a category, search and Saved: header content, then the
/// blocks; tracks what is on screen (counters, the time chip), loads the next page near the end,
/// keeps the reading position when new stories are prepended, and scrolls to seek targets.
struct FeedList<Header: View>: View {
    @Bindable var store: FeedStore
    var showsRail = false
    var header: (Int) -> Header

    init(store: FeedStore, showsRail: Bool = false, @ViewBuilder header: @escaping (Int) -> Header) {
        self.store = store
        self.showsRail = showsRail
        self.header = header
    }
    @Environment(\.cardSizing) private var sizing
    @State private var position = ScrollPosition(idType: String.self)
    @State private var visibleBlocks: [String] = []


    var body: some View {
        GeometryReader { geometry in
            let columns = FeedLayout.columns(forWidth: geometry.size.width, cardMin: sizing.cardMin)
            let blocks = FeedLayout.blocks(store.items, columns: columns)
            ScrollView {
                LazyVStack(spacing: 0) {
                    header(columns)
                    content(blocks: blocks, columns: columns, width: geometry.size.width)
                }
                .scrollTargetLayout()
                .padding(.bottom, 24)
            }
            .scrollPosition($position)
            // prev/next in the story walk the feed (web getAdjacent: the grid's order)
            .environment(\.storyList, StoryListRef(store))
            .onScrollTargetVisibilityChange(idType: String.self, threshold: 0.25) { ids in
                visibleBlocks = ids
                let lookup = Dictionary(uniqueKeysWithValues: blocks.map { ($0.id, $0.items.map(\.id)) })
                store.visibleIDs = ids.flatMap { lookup[$0] ?? [] }
                if let last = ids.last, let index = blocks.firstIndex(where: { $0.id == last }), index >= blocks.count - 3 {
                    Task { await store.loadMore() }
                }
            }
            .onChange(of: store.scrollTarget) { _, target in
                guard let target, let block = blocks.first(where: { $0.items.contains { $0.id == target } }) else { return }
                withAnimation(.snappy) { position.scrollTo(id: block.id, anchor: .top) }
                store.scrollTarget = nil
            }
            .onChange(of: store.items.first?.id) { old, _ in
                guard old != nil, let anchor = visibleBlocks.first else { return }
                let wasAtTop = !blocks.contains { $0.id == anchor } || anchor == blocks.first(where: { block in
                    !store.fresh.contains(where: { block.items.map(\.id).contains($0) })
                })?.id
                if wasAtTop {
                    // the reader was at the top: show what just arrived (web: scrollY ≤ 80)
                    withAnimation(.snappy) { position.scrollTo(edge: .top) }
                } else {
                    // new stories went on top: keep the reader exactly where they were
                    var transaction = Transaction()
                    transaction.disablesAnimations = true
                    withTransaction(transaction) { position.scrollTo(id: anchor, anchor: .top) }
                }
            }
            .refreshable { await store.reload() }
        }
        .environment(\.freshStoryIDs, store.fresh)
        .background { AmbientBackground(hues: store.hues) }
        .safeAreaInset(edge: .trailing, spacing: 0) {
            if showsRail, let scale = store.timescale {
                TimeRail(scale: scale, topID: store.topVisibleID, items: store.items) { fraction in
                    Task { await store.seek(to: fraction) }
                }
                .padding(.leading, 6)
                .padding(.trailing, 14)
                .padding(.vertical, 20)
            }
        }
    }

    @ViewBuilder
    private func content(blocks: [FeedBlock], columns: Int, width: CGFloat) -> some View {
        switch store.phase {
        case .idle where store.isSearch && store.search == nil:
            EmptyView()
        case .idle,
             .loading where store.items.isEmpty:
            ForEach(0..<6, id: \.self) { _ in SkeletonRow().padding(.horizontal, FeedMetrics.gutter(columns)) }
        case .failed(let offline) where store.items.isEmpty:
            ContentUnavailableView {
                Label(L10n.t("feed.error"), systemImage: offline ? "wifi.slash" : "exclamationmark.triangle")
            } description: {
                Text(L10n.t("feed.errorHint"))
            } actions: {
                Button(L10n.t("feed.retry")) { Task { await store.reload() } }
                    .buttonStyle(.glassProminent)
                    .accessibilityIdentifier("feed-retry")
            }
            .padding(.top, 40)
        case .empty:
            if let query = store.search {
                ContentUnavailableView(L10n.t("feed.emptySearch", ["q": query]), systemImage: "magnifyingglass",
                                       description: Text(L10n.t("feed.emptySearchHint")))
                    .padding(.top, 40)
                    .accessibilityIdentifier("empty-search")
            } else {
                ContentUnavailableView(L10n.t("feed.empty"), systemImage: "newspaper", description: Text(L10n.t("feed.emptyHint")))
                    .padding(.top, 40)
                    .accessibilityIdentifier("empty-feed")
            }
        default:
            ForEach(blocks) { block in
                FeedBlockView(block: block, columns: columns, width: width, gutter: FeedMetrics.gutter(columns))
                    .id(block.id)
            }
            if store.isLoadingMore {
                ForEach(0..<3, id: \.self) { _ in SkeletonRow().padding(.horizontal, FeedMetrics.gutter(columns)) }
            }
        }
    }
}

/// "3 NEW STORIES — LOAD": a tinted glass pill that pops in under the chips (web `#newPill`).
struct NewStoriesPill: View {
    let count: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Circle().fill(Tokens.Palette.live).frame(width: 7, height: 7)
                Text(L10n.t(count == 1 ? "feed.newStory" : "feed.newStories", ["n": String(count)]) + " — " + L10n.t("feed.load"))
                    .captionVoice(.white)
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)
        }
        .buttonStyle(.glassProminent)
        .tint(.accentColor)
        .transition(.scale(scale: 0.6).combined(with: .opacity))
        .accessibilityIdentifier("new-stories-pill")
        .sensoryFeedback(.increase, trigger: count)
    }
}

/// The category chips (All … Health).
struct CategoryChips: View {
    let selected: NewsCategory
    let select: (NewsCategory) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    ForEach(NewsCategory.allCases) { category in
                        GlassChip(category.label, isSelected: category == selected) { select(category) }
                            .accessibilityIdentifier("chip-\(category.rawValue)")
                    }
                }
                .padding(.horizontal, Tokens.Space.page)
                .padding(.vertical, 6)
            }
        }
        .scrollClipDisabled()
    }
}

/// The wire strip: UTC with seconds (a red dot), then Tokyo, Delhi, London, New York, Los Angeles.
struct WorldClocks: View {
    let compact: Bool
    /// The app's clock: the time itself, or the instant the UI tests pin (their screenshots agree).
    @Dependency(\.date) private var clock

    private static let zones: [(key: String, zone: String, priority: Bool)] = [
        ("ios.wire.utc", "UTC", true), ("ios.wire.tokyo", "Asia/Tokyo", true), ("ios.wire.delhi", "Asia/Kolkata", false),
        ("ios.wire.london", "Europe/London", false), ("ios.wire.newYork", "America/New_York", true),
        ("ios.wire.losAngeles", "America/Los_Angeles", false),
    ]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { _ in
            let now = clock.now
            let shown = Self.zones.filter { !compact || $0.priority }
            // the clocks wrap onto more lines with large text rather than shrinking to "U… 1…"
            FlowLayout(spacing: 16, lineSpacing: 6) {
                ForEach(shown, id: \.zone) { zone in
                    HStack(spacing: 5) {
                        if zone.zone == "UTC" {
                            Circle().fill(Tokens.Palette.live).frame(width: 5, height: 5)
                        }
                        Text(L10n.t(zone.key)).captionVoice(.secondary)
                        Text(Self.time(now, zone: zone.zone, seconds: zone.zone == "UTC"))
                            .captionVoice(.primary)
                    }
                    .fixedSize()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            // one element that reads the clocks ("UTC 19:39 · Tokyo 04:39 …"): text on screen that
            // assistive technology cannot reach is itself an accessibility failure
            .accessibilityElement(children: .ignore)
            .accessibilityAddTraits(.isStaticText)
            .accessibilityLabel(shown.map { L10n.t($0.key) + " " + Self.time(now, zone: $0.zone, seconds: false) }
                .joined(separator: ", "))
            .accessibilityIdentifier("world-clocks")
        }
    }

    static func time(_ date: Date, zone: String, seconds: Bool) -> String {
        var style = Date.VerbatimFormatStyle(
            format: seconds ? "\(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)):\(minute: .twoDigits):\(second: .twoDigits)"
                : "\(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)):\(minute: .twoDigits)",
            timeZone: TimeZone(identifier: zone) ?? .gmt,
            calendar: Calendar(identifier: .gregorian)
        )
        style.locale = Locale(identifier: "en_GB")
        return date.formatted(style)
    }
}

/// The brief: a glass card above the feed — sparkle, BRIEF, the provider badge, a refresh button,
/// then 5–7 lines (web `#brief`). On a phone it opens folded to three lines so the lead photograph
/// stays above the fold; "Show all" unfolds the rest.
struct BriefCard: View {
    let lines: [String]
    let provider: String
    let isThinking: Bool
    var failed = false
    let refresh: () -> Void
    @State private var expanded = false
    @Environment(\.dynamicTypeSize) private var typeSize
    private static let folded = 3

    @ViewBuilder
    private var status: some View {
        if !isThinking {
            Badge(TextKit.providerLabel(provider), tint: Tokens.Palette.ai).fixedSize()
        } else {
            Text(L10n.t("brief.working")).captionVoice(.secondary)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Tokens.Palette.ai.gradient, in: Circle())
                Text(L10n.t("brief.label")).captionVoice(.primary)
                if !typeSize.isAccessibilitySize { status }
                Spacer()
                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .semibold))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel(L10n.t("brief.rerun"))
            }
            // with large text the provider gets a line of its own (it wrapped mid-word beside BRIEF)
            if typeSize.isAccessibilitySize { status }
            if isThinking {
                ThinkingBars()
            } else if lines.isEmpty {
                Text(L10n.t(failed ? "brief.error" : "brief.empty")).font(.subheadline).foregroundStyle(.secondary)
            } else {
                let visible = expanded ? lines : Array(lines.prefix(Self.folded))
                VStack(alignment: .leading, spacing: 9) {
                    ForEach(Array(visible.enumerated()), id: \.offset) { _, line in
                        let also = line.hasPrefix("Also: ")
                        HStack(alignment: .firstTextBaseline, spacing: 9) {
                            Circle()
                                .fill(also ? AnyShapeStyle(.tertiary) : AnyShapeStyle(Tokens.Palette.ai))
                                .frame(width: 5, height: 5)
                                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                            Text(line)
                                .font(.subheadline.weight(also ? .regular : .medium))
                                .foregroundStyle(also ? .secondary : .primary)
                        }
                    }
                    if lines.count > Self.folded {
                        Button {
                            withAnimation(.snappy) { expanded.toggle() }
                        } label: {
                            HStack(spacing: 4) {
                                Text(L10n.t(expanded ? "ios.brief.less" : "ios.brief.more", ["n": String(lines.count - Self.folded)]))
                                Image(systemName: expanded ? "chevron.up" : "chevron.down").imageScale(.small)
                            }
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Tokens.Palette.ai)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.vertical, -10) // the target grows, the layout does not
                        .accessibilityIdentifier("brief-toggle")
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Tokens.Radius.panel, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("brief")
    }
}

