import ArticleKit
import CoreModels
import DesignSystem
import Intelligence
import SwiftUI

/// Bubble Battle: one story, every angle. On a wide window the clusters are a physics arena
/// (drag the tiles, watch them fight); on a phone — and wherever motion is reduced — each story
/// lays its coverage out in lanes, left to right (the web's static mode, redesigned for the
/// narrow screen).
public struct BattleView: View {
    @Bindable private var store: BattleStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(store: BattleStore) {
        self.store = store
    }

    public var body: some View {
        Group {
            switch store.phase {
            case .idle, .loading:
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(0..<4, id: \.self) { _ in SkeletonRow().padding(.horizontal, Tokens.Space.page) }
                    }
                }
            case .failed:
                ContentUnavailableView {
                    Label(L10n.t("battle.error"), systemImage: "exclamationmark.triangle")
                } actions: {
                    Button(L10n.t("feed.retry")) { Task { await store.load() } }.buttonStyle(.glass)
                }
            case .empty:
                ContentUnavailableView(L10n.t("battle.empty"), systemImage: "bubbles.and.sparkles")
                    .accessibilityIdentifier("battle-empty")
            case .loaded:
                if sizeClass == .regular, !reduceMotion {
                    BattleArena(store: store)
                } else {
                    BattleLanes(store: store)
                }
            }
        }
        .background { AmbientBackground(hues: [256, 214, 4]) }
        .navigationTitle(L10n.t("cat.battle"))
        .task { await store.appear() }
    }
}

// MARK: - Pieces

public enum BattleTopic {
    /// The cluster's title: its topic tokens without the words a longer token already names
    /// (the server sends a bigram and its parts: "Supreme Court", "Supreme", "Court"). The web
    /// prints every token in small caps; as a heading the repeats read as a stutter.
    public static func title(_ topic: [String]) -> String {
        var kept: [String] = []
        for token in topic {
            let words = Set(kept.flatMap { $0.lowercased().split(separator: " ").map(String.init) })
            let own = token.lowercased().split(separator: " ").map(String.init)
            if own.count == 1, words.contains(own[0]) { continue }
            kept.append(token)
        }
        return kept.joined(separator: " \u{b7} ")
    }
}

extension Lean {
    var tint: Color {
        switch self {
        case .left: Tokens.Palette.leanLeft
        case .center: Tokens.Palette.leanCenter
        case .right: Tokens.Palette.leanRight
        }
    }

    var label: String { L10n.t("battle.\(rawValue)") }
}

/// LEFT · CENTER · RIGHT, the hint, when the clusters were built.
struct BattleLegend: View {
    let updatedAt: Timestamp?
    let showsHint: Bool
    @Environment(\.clockNow) private var now

    var body: some View {
        FlowLayout(spacing: 8, lineSpacing: 8) {
            ForEach(Lean.allCases, id: \.self) { lean in
                HStack(spacing: 6) {
                    Circle().fill(lean.tint).frame(width: 8, height: 8)
                    Text(lean.label).captionVoice(.primary)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .glassEffect(.regular, in: .capsule)
            }
            if showsHint {
                Text(L10n.t("battle.hint")).font(.footnote).foregroundStyle(.secondary)
            }
            if let updatedAt {
                Text(RelativeTime.relTime(updatedAt, now: now)).captionVoice(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("battle-legend")
    }
}

/// The glass HOW COVERAGE DIFFERS card of a cluster.
struct BattleBriefCard: View {
    let brief: BattleStore.Brief?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch brief {
            case .none, .thinking:
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text(L10n.t("brief.working")).captionVoice(.secondary)
                }
            case .bullets(let lines):
                head
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle().fill(Tokens.Palette.ai).frame(width: 5, height: 5)
                        Text(line).font(.subheadline)
                    }
                }
            case .rows(let rows):
                head
                ForEach(rows, id: \.lean) { row in
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Circle().fill(row.lean.tint).frame(width: 7, height: 7)
                            Text(row.lean.label + " · " + row.source).captionVoice(.primary).lineLimit(1)
                        }
                        Text(row.stanceText)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(row.stance == .critical ? Tokens.Palette.critical
                                             : row.stance == .supportive ? Tokens.Palette.supportive : .primary.opacity(0.72))
                        if let evidence = row.evidence {
                            Text("\u{201C}" + evidence + "\u{201D}")
                                .font(.footnote.italic())
                                .foregroundStyle(.primary.opacity(0.72))
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: Tokens.Radius.panel, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("battle-brief")
        .animation(.smooth(duration: 0.3), value: brief)
    }

    private var head: some View {
        Text(L10n.t("battle.diffHead")).captionVoice(Tokens.Palette.ai)
    }
}

/// One viewpoint: a rounded-square poster of the story, ringed in its lean's colour.
struct BubbleTile: View {
    let article: Article
    let side: CGFloat
    var isFighting = false
    /// The title follows Dynamic Type up to a third larger: the tile is a poster of fixed size.
    @ScaledMetric(relativeTo: .headline) private var typeScale: CGFloat = 1
    @Environment(ArticleStateStore.self) private var states
    @Environment(\.clockNow) private var now
    @Environment(\.colorScheme) private var scheme
    @Environment(\.provenanceRegistry) private var registry

    var body: some View {
        let live = states.live(article)
        let title = live.translation?.title ?? article.title
        let shape = RoundedRectangle(cornerRadius: side * 0.22, style: .continuous)
        let provenance = article.source.provenance.resolved(sourceID: article.source.id, registry: registry)
        let country = CountryNames.name(for: provenance)
        let font = max(11, min(20, side * 0.075)) * min(typeScale, 1.35)
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: article.image, minimumPixelWidth: 200) {
                SourceTile(sourceID: article.source.id, sourceName: article.source.name, letterScale: 0.42, letterOffset: -0.2)
            }
            // dark enough under the small print (source, time) whatever the photo
            LinearGradient(stops: [.init(color: .black.opacity(0.0), location: 0.1),
                                   .init(color: .black.opacity(0.55), location: 0.45),
                                   .init(color: .black.opacity(0.86), location: 1)],
                           startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: side * 0.03) {
                HStack(spacing: 4) {
                    FlagView(provenance, size: font * 0.95, ringed: true)
                    Text(article.source.name).captionVoice(Color.white).lineLimit(1)
                }
                Text(title)
                    .font(.system(size: font, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(side > 200 ? 5 : 4)
                    .fixedSize(horizontal: false, vertical: true)
                Text(RelativeTime.relTime(article.publishedAt, now: now)).captionVoice(Tokens.Palette.onPhotoSecondary)
            }
            .padding(side * 0.08)
        }
        .frame(width: side, height: side)
        .clipShape(shape)
        .overlay(shape.strokeBorder((article.lean?.tint ?? .secondary).opacity(0.95), lineWidth: isFighting ? 5 : 3))
        .shadow(color: (isFighting ? article.lean?.tint ?? .black : .black).opacity(scheme == .dark ? 0.55 : 0.25),
                radius: isFighting ? 22 : 12, y: 8)
        .scaleEffect(isFighting ? 1.05 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: isFighting)
        .contentShape(shape)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([article.source.name, country].filter { !$0.isEmpty }.joined(separator: ", ") + " \u{2014} " + title
                            + " \u{2014} " + RelativeTime.relTime(article.publishedAt, now: now))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("bubble-\(article.id)")
        .task(id: states.translationEpoch) { states.autoTranslate(article) }
    }
}

// MARK: - Lanes (phones, reduced motion)

/// Each story, then its coverage in lanes by lean — a row of tiles per side, scrolled sideways.
struct BattleLanes: View {
    let store: BattleStore

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 34) {
                BattleLegend(updatedAt: store.updatedAt, showsHint: false)
                    .padding(.horizontal, Tokens.Space.page)
                ForEach(store.battles) { battle in
                    BattleLaneSection(battle: battle, brief: store.briefs[battle.id])
                        .onScrollVisibilityChange(threshold: 0.15) { visible in
                            store.clusterVisible(battle.id, visible)
                        }
                }
            }
            .padding(.top, 6)
            .padding(.bottom, 28)
        }
        .refreshable { await store.load() }
        .accessibilityIdentifier("battle-lanes")
    }
}

struct BattleLaneSection: View {
    let battle: Battle
    let brief: BattleStore.Brief?
    @Environment(\.openStory) private var openStory

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(BattleTopic.title(battle.topic))
                .heavyTitle(20, relativeTo: .title3)
                .padding(.horizontal, Tokens.Space.page)
                .accessibilityAddTraits(.isHeader)
            BattleBriefCard(brief: brief)
                .padding(.horizontal, Tokens.Space.page)
            ForEach(Lean.allCases, id: \.self) { lean in
                let articles = battle.articles.filter { $0.lean == lean }
                if !articles.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Capsule().fill(lean.tint).frame(width: 18, height: 4)
                            Text(lean.label + " \u{b7} " + String(articles.count)).captionVoice(Color.primary.opacity(0.72))
                        }
                        .padding(.horizontal, Tokens.Space.page)
                        ScrollView(.horizontal) {
                            LazyHStack(spacing: 12) {
                                ForEach(articles) { article in
                                    BubbleTile(article: article, side: 168)
                                        .onTapGesture { openStory?(article, in: battle.articles) }
                                        .accessibilityAction { openStory?(article, in: battle.articles) }
                                }
                            }
                            .padding(.vertical, 10)
                        }
                        .contentMargins(.horizontal, Tokens.Space.page, for: .scrollContent)
                        .scrollIndicators(.hidden)
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("battle-\(battle.id)")
    }
}
