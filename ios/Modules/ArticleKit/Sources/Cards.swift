import CoreModels
import DesignSystem
import SwiftUI

/// What a card can do. Surfaces inject their handlers through the environment; unset handlers
/// are no-ops, so a card renders anywhere (previews, screenshots).
public struct CardActions {
    public var open: @MainActor (Article) -> Void = { _ in }
    public var toggleSave: @MainActor (Article) -> Void = { _ in }
    public var translate: @MainActor (Article) -> Void = { _ in }
    public var vote: @MainActor (Article, Vote) -> Void = { _, _ in }
    public var openOriginal: @MainActor (Article) -> Void = { _ in }

    public init() {}
}

/// Per-card display state that lives outside the immutable `Article` (P2: `ArticleStateStore`).
public struct CardState: Hashable, Sendable {
    public var reactions: Reactions?
    public var isSaved: Bool
    public var translatedTitle: String?
    public var translatedDescription: String?

    public init(reactions: Reactions? = nil, isSaved: Bool = false, translatedTitle: String? = nil, translatedDescription: String? = nil) {
        self.reactions = reactions
        self.isSaved = isSaved
        self.translatedTitle = translatedTitle
        self.translatedDescription = translatedDescription
    }
}

public extension EnvironmentValues {
    @Entry var cardActions = CardActions()
    @Entry var cardSizing = CardSizing.standard
    /// "Now" for datelines, epoch ms — a ticking clock in the app, fixed in tests.
    @Entry var clockNow: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    /// Source id → home, for stories saved before `source.country` existed.
    @Entry var provenanceRegistry: [String: Provenance] = [:]
}

/// Any feed card, by variant.
public struct ArticleCard: View {
    private let item: FeedItem
    private let state: CardState
    private let height: CGFloat?

    /// - Parameter height: fixed height in the regular-width mosaic; `nil` = natural (compact).
    public init(_ item: FeedItem, state: CardState = CardState(), height: CGFloat? = nil) {
        self.item = item
        self.state = state
        self.height = height
    }

    public var body: some View {
        Group {
            switch item.variant {
            case .hero, .wide: PosterCard(item: item, state: state, height: height)
            case .row, .text: RowCard(item: item, state: state)
            }
        }
    }
}

// MARK: - Poster

struct PosterCard: View {
    let item: FeedItem
    let state: CardState
    let height: CGFloat?
    @Environment(\.cardSizing) private var sizing
    @Environment(\.colorScheme) private var scheme
    @Environment(\.cardActions) private var actions

    private var isHero: Bool { item.variant == .hero }

    var body: some View {
        let article = item.article
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.poster, style: .continuous)
        Button { actions.open(article) } label: {
            ZStack(alignment: .bottomLeading) {
                // the poster's proportion is a minimum: a long headline grows the card instead of
                // being squeezed into the byline
                if height == nil {
                    Color.clear.aspectRatio(isHero ? 4.0 / 5.0 : 16.0 / 10.0, contentMode: .fit)
                }
                VStack(alignment: .leading, spacing: 6) {
                    Dateline(article: article, onPhoto: true)
                    Text(state.translatedTitle ?? article.title)
                        .heavyTitle(sizing.posterTitle - (isHero ? 0 : 4), relativeTo: .title)
                        .foregroundStyle(.white)
                        .lineLimit(isHero ? 5 : 3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if isHero, sizing.posterDescriptions, !article.description.isEmpty {
                        Text(state.translatedDescription ?? article.description)
                            .font(.subheadline)
                            .foregroundStyle(Tokens.Palette.onPhotoSecondary)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    CardFooter(article: article, state: state, onPhoto: true)
                        .padding(.top, 6)
                }
                .padding(18)
            }
            .frame(maxWidth: .infinity, alignment: .bottomLeading)
            .frame(height: height)
            .background {
                ZStack {
                    RemoteImage(url: article.image, minimumPixelWidth: isHero ? 620 : 0) {
                        SourceTile(sourceID: article.source.id, sourceName: article.source.name, letterScale: 0.36, letterOffset: -0.18)
                    }
                    LinearGradient(
                        stops: [
                            .init(color: .black.opacity(0.06), location: 0.3),
                            .init(color: Tokens.Palette.photoFade(scheme), location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                }
            }
            .clipShape(shape)
            .contentShape(shape)
            .shadow(color: .black.opacity(scheme == .dark ? 0.5 : 0.18), radius: 15, y: 12)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.t("card.preview", ["title": article.title]))
        .accessibilityIdentifier("card-\(article.id)")
    }
}

// MARK: - Row

struct RowCard: View {
    let item: FeedItem
    let state: CardState
    @Environment(\.cardSizing) private var sizing
    @Environment(\.cardActions) private var actions

    var body: some View {
        let article = item.article
        Button { actions.open(article) } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 5) {
                        Dateline(article: article, onPhoto: false)
                        Text(state.translatedTitle ?? article.title)
                            .font(.body.weight(.semibold))
                            .tracking(-0.2)
                            .foregroundStyle(.primary)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                        if sizing.rowDescriptions, !article.description.isEmpty {
                            Text(state.translatedDescription ?? article.description)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if item.variant == .row {
                        RemoteImage(url: article.image) {
                            SourceTile(sourceID: article.source.id, sourceName: article.source.name)
                        }
                        .frame(width: sizing.thumb, height: sizing.thumb)
                        .clipShape(RoundedRectangle(cornerRadius: Tokens.Radius.thumb, style: .continuous))
                    }
                }
                CardFooter(article: article, state: state, onPhoto: false)
            }
            .padding(.vertical, Tokens.Space.row)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.t("card.preview", ["title": article.title]))
        .accessibilityIdentifier("card-\(article.id)")
    }
}

// MARK: - Pieces

/// Freshness dot + relative time, then the byline: flag · source · country (country truncates first).
public struct Dateline: View {
    let article: Article
    let onPhoto: Bool
    @Environment(\.clockNow) private var now
    @Environment(\.provenanceRegistry) private var registry

    public init(article: Article, onPhoto: Bool) {
        self.article = article
        self.onPhoto = onPhoto
    }

    public var body: some View {
        let secondary: Color = onPhoto ? Tokens.Palette.onPhotoSecondary : .secondary
        let provenance = article.source.provenance.resolved(sourceID: article.source.id, registry: registry)
        let country = CountryNames.name(for: provenance)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                FreshnessDot(RelativeTime.freshness(article.publishedAt, now: now), onPhoto: onPhoto)
                Text(RelativeTime.relTime(article.publishedAt, now: now))
                    .captionVoice(secondary)
            }
            HStack(spacing: 5) {
                FlagView(provenance, size: 15, ringed: onPhoto)
                Text(article.source.name)
                    .captionVoice(onPhoto ? Color.white : Color.primary)
                    .lineLimit(1)
                    .layoutPriority(1)
                if provenance != .unknown, !country.isEmpty {
                    Text("· " + country)
                        .captionVoice(secondary.opacity(0.78))
                        .lineLimit(1)
                }
            }
        }
    }
}

/// ▲ n ▼ n 💬 n … translate · save · open (web `.card-foot`).
public struct CardFooter: View {
    let article: Article
    let state: CardState
    let onPhoto: Bool
    @Environment(\.cardActions) private var actions

    public init(article: Article, state: CardState, onPhoto: Bool) {
        self.article = article
        self.state = state
        self.onPhoto = onPhoto
    }

    public var body: some View {
        let reactions = state.reactions ?? article.reactions ?? .zero
        let tint: Color = onPhoto ? Tokens.Palette.onPhotoSecondary : .secondary
        HStack(spacing: 14) {
            counter("arrow.up", reactions.up, pressed: reactions.myVote == .up, tint: tint,
                    label: L10n.t("card.like")) { actions.vote(article, .up) }
            counter("arrow.down", reactions.down, pressed: reactions.myVote == .down, tint: tint,
                    label: L10n.t("card.dislike")) { actions.vote(article, .down) }
            if reactions.comments > 0 {
                Label("\(reactions.comments)", systemImage: "bubble.left")
                    .labelStyle(CompactLabel())
                    .captionVoice(tint)
                    .accessibilityLabel(L10n.t("card.comments", ["n": String(reactions.comments)]))
            }
            Spacer(minLength: 8)
            circle(state.translatedTitle == nil ? "globe" : "globe.badge.chevron.backward",
                   label: L10n.t(state.translatedTitle == nil ? "card.translate" : "card.showOriginal")) { actions.translate(article) }
            circle(state.isSaved ? "bookmark.fill" : "bookmark",
                   label: L10n.t(state.isSaved ? "card.unsave" : "card.save")) { actions.toggleSave(article) }
            circle("arrow.up.right.square", label: L10n.t("card.open")) { actions.openOriginal(article) }
        }
    }

    private func counter(_ symbol: String, _ count: Int, pressed: Bool, tint: Color, label: String,
                         action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            Label("\(count)", systemImage: symbol)
                .labelStyle(CompactLabel())
                .captionVoice(pressed ? (onPhoto ? Color.white : Color.accentColor) : tint)
                .frame(minHeight: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(String(count))
        .accessibilityAddTraits(pressed ? .isSelected : [])
    }

    private func circle(_ symbol: String, label: String, action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: onPhoto ? 15 : 13, weight: .semibold))
                .foregroundStyle(onPhoto ? Color.white : Color.secondary)
                .frame(width: onPhoto ? 36 : 30, height: onPhoto ? 36 : 30)
                .background {
                    // translucent, not blurred: posters are many (the web keeps glass off them)
                    Circle().fill(onPhoto ? AnyShapeStyle(Color.white.opacity(0.22)) : AnyShapeStyle(.fill.tertiary))
                }
                .overlay {
                    if onPhoto { Circle().strokeBorder(.white.opacity(0.35), lineWidth: 0.5) }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

struct CompactLabel: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon.imageScale(.small)
            configuration.title
        }
    }
}
