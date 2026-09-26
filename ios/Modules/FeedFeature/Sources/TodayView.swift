import ArticleKit
import CoreModels
import DesignSystem
import Intelligence
import SwiftUI

/// Today (or one category): world clocks, the brief, then the freshest-first mosaic — photos as
/// the material, Liquid Glass only on the controls floating above them.
public struct TodayView: View {
    @Bindable private var store: FeedStore
    @Environment(\.cardSizing) private var sizing
    @Environment(\.clockNow) private var now

    public init(store: FeedStore) {
        self.store = store
    }

    public var body: some View {
        GeometryReader { geometry in
            let columns = FeedLayout.columns(forWidth: geometry.size.width, cardMin: sizing.cardMin)
            ScrollView {
                LazyVStack(spacing: 0) {
                    if !store.isCategoryLocked {
                        CategoryChips(selected: store.category) { store.select($0) }
                            .padding(.bottom, 10)
                    }
                    WorldClocks(compact: columns == 1)
                        .padding(.horizontal, gutter(columns))
                        .padding(.top, 2)
                        .padding(.bottom, 12)
                    BriefCard(lines: store.brief, provider: "local", isThinking: store.phase == .loading) {
                        Task { await store.reload() }
                    }
                    .padding(.horizontal, gutter(columns))
                    .padding(.bottom, 6)
                    content(columns: columns, width: geometry.size.width)
                }
                .padding(.bottom, 24)
            }
            .refreshable { await store.reload() }
        }
        .background { AmbientBackground(hues: store.hues) }
        .navigationTitle(store.title)
        .navigationSubtitle(Self.dateline(now))
        .task { await store.appear() }
    }

    @ViewBuilder
    private func content(columns: Int, width: CGFloat) -> some View {
        switch store.phase {
        case .idle, .loading where store.items.isEmpty:
            ForEach(0..<6, id: \.self) { _ in SkeletonRow().padding(.horizontal, gutter(columns)) }
        case .failed(let offline) where store.items.isEmpty:
            ContentUnavailableView {
                Label(L10n.t("feed.error"), systemImage: offline ? "wifi.slash" : "exclamationmark.triangle")
            } description: {
                Text(L10n.t("feed.errorHint"))
            } actions: {
                Button(L10n.t("feed.retry")) { Task { await store.reload() } }
                    .buttonStyle(.glassProminent)
            }
            .padding(.top, 40)
        case .empty:
            ContentUnavailableView(L10n.t("feed.empty"), systemImage: "newspaper", description: Text(L10n.t("feed.emptyHint")))
                .padding(.top, 40)
        default:
            let blocks = FeedLayout.blocks(store.items, columns: columns)
            ForEach(blocks) { block in
                FeedBlockView(block: block, columns: columns, width: width, gutter: gutter(columns))
            }
        }
    }

    private func gutter(_ columns: Int) -> CGFloat {
        columns == 1 ? Tokens.Space.page : 24
    }

    /// "Saturday, 26 September" — the web's `#feedDate` (device locale), recomputed with the clock
    /// so it rolls over at midnight.
    static func dateline(_ now: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(now) / 1000)
        return date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }
}

/// One mosaic block: a row of cards, or a poster with cards stacked beside it.
struct FeedBlockView: View {
    let block: FeedBlock
    let columns: Int
    let width: CGFloat
    let gutter: CGFloat
    @Environment(\.cardSizing) private var sizing

    private let spacing: CGFloat = 32

    var body: some View {
        let columnWidth = (width - gutter * 2 - spacing * CGFloat(columns - 1)) / CGFloat(max(columns, 1))
        switch block {
        case .row(let items) where columns == 1:
            VStack(spacing: 0) {
                ArticleCard(items[0])
                Divider()
            }
            .padding(.horizontal, gutter)
        case .row(let items):
            HStack(alignment: .top, spacing: spacing) {
                ForEach(items) { item in
                    cell(item).frame(width: columnWidth)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, gutter)
        case .poster(let item, _) where columns == 1:
            ArticleCard(item)
                .padding(.horizontal, gutter)
                .padding(.vertical, 14)
        case .poster(let item, let side):
            let span = item.variant == .hero ? 3 : 2
            HStack(alignment: .top, spacing: spacing) {
                ArticleCard(item, height: sizing.rowHeight * CGFloat(span) - 28)
                    .frame(width: columnWidth * 2 + spacing)
                    .padding(.vertical, 14)
                ForEach(Array(side.enumerated()), id: \.offset) { _, stack in
                    VStack(spacing: 0) {
                        ForEach(stack) { cell($0) }
                    }
                    .frame(width: columnWidth)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, gutter)
        }
    }

    private func cell(_ item: FeedItem) -> some View {
        VStack(spacing: 0) {
            ArticleCard(item)
            Spacer(minLength: 0)
            Divider()
        }
        .frame(height: sizing.rowHeight, alignment: .top)
        .clipped()
    }
}

/// The category chips (All … Health) riding the top scroll edge.
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

    private static let zones: [(key: String, zone: String, priority: Bool)] = [
        ("ios.wire.utc", "UTC", true), ("ios.wire.tokyo", "Asia/Tokyo", true), ("ios.wire.delhi", "Asia/Kolkata", false),
        ("ios.wire.london", "Europe/London", false), ("ios.wire.newYork", "America/New_York", true),
        ("ios.wire.losAngeles", "America/Los_Angeles", false),
    ]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack(spacing: 16) {
                ForEach(Self.zones.filter { !compact || $0.priority }, id: \.zone) { zone in
                    HStack(spacing: 5) {
                        if zone.zone == "UTC" {
                            Circle().fill(Tokens.Palette.live).frame(width: 5, height: 5)
                        }
                        Text(L10n.t(zone.key)).captionVoice(.secondary)
                        Text(Self.time(context.date, zone: zone.zone, seconds: zone.zone == "UTC"))
                            .captionVoice(.primary)
                    }
                }
                Spacer(minLength: 0)
            }
            .lineLimit(1)
        }
        .accessibilityHidden(true)
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
/// then 5–7 lines (web `#brief`). On a phone it opens folded to the developing stories (at most
/// three lines) so the lead photograph stays above the fold; "Show all" unfolds the rest.
struct BriefCard: View {
    let lines: [String]
    let provider: String
    let isThinking: Bool
    let refresh: () -> Void
    @State private var expanded = false
    private static let folded = 3

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 26, height: 26)
                    .background(Tokens.Palette.ai.gradient, in: Circle())
                Text(L10n.t("brief.label")).captionVoice(.primary)
                if !isThinking {
                    Badge(TextKit.providerLabel(provider), tint: Tokens.Palette.ai)
                } else {
                    Text(L10n.t("brief.working")).captionVoice(.secondary)
                }
                Spacer()
                Button(action: refresh) {
                    Image(systemName: "arrow.clockwise").font(.system(size: 13, weight: .semibold))
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel(L10n.t("brief.rerun"))
            }
            if isThinking {
                ThinkingBars()
            } else if lines.isEmpty {
                Text(L10n.t("brief.empty")).font(.subheadline).foregroundStyle(.secondary)
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
                            .padding(.top, 2)
                        }
                        .buttonStyle(.plain)
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

/// A row-shaped placeholder while the first page loads (web `skeletonCard`).
struct SkeletonRow: View {
    @Environment(\.cardSizing) private var sizing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).frame(width: 110, height: 10)
                RoundedRectangle(cornerRadius: 4).frame(height: 14)
                RoundedRectangle(cornerRadius: 4).frame(height: 14)
                RoundedRectangle(cornerRadius: 4).frame(width: 180, height: 14)
            }
            RoundedRectangle(cornerRadius: Tokens.Radius.thumb, style: .continuous)
                .frame(width: sizing.thumb, height: sizing.thumb)
        }
        .foregroundStyle(.quaternary)
        .opacity(dim ? 0.45 : 1)
        .padding(.vertical, Tokens.Space.row)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityHidden(true)
    }
}
