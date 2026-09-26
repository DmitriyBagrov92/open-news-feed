import CoreModels
import DesignSystem
import SwiftUI
import UIKit

/// What a card does when asked to open its source (the in-app browser). Opening the story itself
/// goes through `openStory` with the surface's `storyList`; saving, translating and voting go
/// through `ArticleStateStore`. Unset handlers are no-ops, so a card renders anywhere.
public struct CardActions: Equatable {
    public var openOriginal: @MainActor (Article) -> Void = { _ in }
    /// Equal ids promise the same behaviour, so a new value from a parent update does not update
    /// every card (see `OpenStoryAction`).
    private let id: AnyHashable

    public init(id: AnyHashable = "none") {
        self.id = id
    }

    public static func == (lhs: CardActions, rhs: CardActions) -> Bool { lhs.id == rhs.id }
}

/// Tapping a card: the story view with the surface's list as prev/next context.
struct OpenCard: ViewModifier {
    let article: Article
    @Environment(\.openStory) private var openStory
    @Environment(\.storyList) private var list
    @Environment(\.cardActions) private var actions

    func body(content: Content) -> some View {
        content.onTapGesture {
            openCard(article, openStory: openStory, list: list, actions: actions)
        }
    }
}

/// Opens the story in its list, or — where no surface handles stories — the original.
@MainActor
func openCard(_ article: Article, openStory: OpenStoryAction?, list: StoryListRef?, actions: CardActions) {
    if let openStory {
        openStory(article, in: list?.source.storyList ?? [article])
    } else {
        actions.openOriginal(article)
    }
}

public extension EnvironmentValues {
    @Entry var cardActions = CardActions()
    @Entry var cardSizing = CardSizing.standard
    /// "Now" for datelines, epoch ms — a ticking clock in the app, fixed in tests.
    @Entry var clockNow: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    /// Source id → home, for stories saved before `source.country` existed.
    @Entry var provenanceRegistry: [String: Provenance] = [:]
    /// Stories to highlight for a moment (just prepended from the "new stories" pill).
    @Entry var freshStoryIDs: Set<String> = []
}

/// Any feed card, by variant, wired to the shared live state: counters, saved flag, translation,
/// context menu with preview, accessibility actions, and the row swipe.
public struct ArticleCard: View {
    private let item: FeedItem
    private let height: CGFloat?
    private let swipes: Bool
    @Environment(ArticleStateStore.self) private var store: ArticleStateStore?
    @Environment(\.cardActions) private var actions
    @Environment(\.freshStoryIDs) private var fresh
    @Environment(\.storyZoomNamespace) private var zoom

    /// - Parameters:
    ///   - height: fixed height in the regular-width mosaic; `nil` = natural (compact).
    ///   - swipes: row swipe actions (off inside the fixed-height mosaic cells).
    public init(_ item: FeedItem, height: CGFloat? = nil, swipes: Bool = true) {
        self.item = item
        self.height = height
        self.swipes = swipes
    }

    public var body: some View {
        let article = item.article
        let live = store?.live(article)
        let snapshot = CardSnapshot(article: article, live: live)
        Group {
            switch item.variant {
            case .hero, .wide:
                PosterCard(item: item, snapshot: snapshot, height: height)
            case .row, .text:
                RowCard(item: item, snapshot: snapshot)
                    .swipeToCommit(
                        leading: swipes ? SwipeAction(
                            title: L10n.t(snapshot.isSaved ? "card.unsave" : "card.save"),
                            systemImage: snapshot.isSaved ? "bookmark.slash.fill" : "bookmark.fill",
                            tint: .green
                        ) { Task { await store?.toggleSave(article) } } : nil,
                        trailing: swipes ? SwipeAction(
                            title: L10n.t(snapshot.isTranslated ? "card.showOriginal" : "card.translate"),
                            systemImage: "globe",
                            tint: .accentColor
                        ) { Task { await store?.toggleTranslation(article) } } : nil
                    )
            }
        }
        .overlay {
            if fresh.contains(article.id) {
                RoundedRectangle(cornerRadius: item.variant.isPoster ? Tokens.Radius.poster : 16, style: .continuous)
                    .strokeBorder(Color.accentColor, lineWidth: 2)
                    .shadow(color: .accentColor.opacity(0.35), radius: 8)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }
        }
        .storyZoomSource(id: article.id, namespace: zoom)
        .contextMenu {
            CardMenu(article: article, snapshot: snapshot)
        } preview: {
            CardPreview(article: article, snapshot: snapshot)
        }
        // on screen: ask for the auto-translation (again whenever the language or the switch changes)
        .task(id: store?.translationEpoch) { store?.autoTranslate(article) }
        .accessibilityAction(named: L10n.t(snapshot.isSaved ? "card.unsave" : "card.save")) {
            Task { await store?.toggleSave(article) }
        }
        .accessibilityAction(named: L10n.t(snapshot.isTranslated ? "card.showOriginal" : "card.translate")) {
            Task { await store?.toggleTranslation(article) }
        }
        .accessibilityAction(named: L10n.t("card.open")) { actions.openOriginal(article) }
    }
}

/// What a card shows right now: the article merged with its live state.
struct CardSnapshot {
    let title: String
    let description: String
    let reactions: Reactions
    let isSaved: Bool
    let isTranslated: Bool
    let isTranslating: Bool

    @MainActor
    init(article: Article, live: ArticleLiveState?) {
        title = live?.translation?.title ?? article.title
        description = live?.translation?.description ?? article.description
        reactions = live?.reactions ?? article.reactions ?? .zero
        isSaved = live?.isSaved ?? false
        isTranslated = live?.translation != nil
        isTranslating = live?.isTranslating ?? false
    }
}

/// The long-press / right-click menu (web `menu.js`): save, translate, open, share, copy.
struct CardMenu: View {
    let article: Article
    let snapshot: CardSnapshot
    @Environment(ArticleStateStore.self) private var store: ArticleStateStore?
    @Environment(\.cardActions) private var actions

    var body: some View {
        Button(L10n.t(snapshot.isSaved ? "card.unsave" : "card.save"),
               systemImage: snapshot.isSaved ? "bookmark.slash" : "bookmark") {
            Task { await store?.toggleSave(article) }
        }
        Button(L10n.t(snapshot.isTranslated ? "card.showOriginal" : "card.translate"), systemImage: "globe") {
            Task { await store?.toggleTranslation(article) }
        }
        Button(L10n.t("card.open"), systemImage: "safari") { actions.openOriginal(article) }
        ShareLink(item: article.url, subject: Text(article.title), message: Text(article.title)) {
            Label(L10n.t("card.share"), systemImage: "square.and.arrow.up")
        }
        Button(L10n.t("ios.card.copyLink"), systemImage: "link") {
            UIPasteboard.general.url = article.url
        }
    }
}

/// The context-menu preview: the photo, the byline and the full headline and description.
struct CardPreview: View {
    let article: Article
    let snapshot: CardSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if article.image != nil {
                RemoteImage(url: article.image) {
                    SourceTile(sourceID: article.source.id, sourceName: article.source.name)
                }
                .frame(height: 200)
                .clipped()
            }
            VStack(alignment: .leading, spacing: 8) {
                Dateline(article: article, onPhoto: false)
                Text(snapshot.title).font(.title3.weight(.bold))
                if !snapshot.description.isEmpty {
                    Text(snapshot.description).font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(18)
        }
        .frame(width: 360)
        .background(Color(.systemBackground))
    }
}

// MARK: - Poster

struct PosterCard: View {
    let item: FeedItem
    let snapshot: CardSnapshot
    let height: CGFloat?
    @Environment(\.cardSizing) private var sizing
    @Environment(\.colorScheme) private var scheme
    @Environment(\.cardActions) private var actions

    private var isHero: Bool { item.variant == .hero }

    var body: some View {
        let article = item.article
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.poster, style: .continuous)
        ZStack(alignment: .bottomLeading) {
            // the poster's proportion is a minimum: a long headline grows the card instead of
            // being squeezed into the byline
            if height == nil {
                Color.clear.aspectRatio(isHero ? 4.0 / 5.0 : 16.0 / 10.0, contentMode: .fit)
            }
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 6) {
                    Dateline(article: article, onPhoto: true)
                    Text(snapshot.title)
                        .heavyTitle(sizing.posterTitle - (isHero ? 0 : 4), relativeTo: .title)
                        .foregroundStyle(.white)
                        .lineLimit(isHero ? 5 : 3)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if isHero, sizing.posterDescriptions, !snapshot.description.isEmpty {
                        Text(snapshot.description)
                            .font(.subheadline)
                            .foregroundStyle(Tokens.Palette.onPhotoSecondary)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .cardHeadlineAccessibility(article: article, title: snapshot.title)
                CardFooter(article: article, snapshot: snapshot, onPhoto: true)
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
        .contentShape(.contextMenuPreview, shape)
        .contentShape(shape)
        .modifier(OpenCard(article: article))
        .shadow(color: .black.opacity(scheme == .dark ? 0.5 : 0.18), radius: 15, y: 12)
    }
}

// MARK: - Row

struct RowCard: View {
    let item: FeedItem
    let snapshot: CardSnapshot
    @Environment(\.cardSizing) private var sizing
    @Environment(\.cardActions) private var actions

    var body: some View {
        let article = item.article
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    Dateline(article: article, onPhoto: false)
                    Text(snapshot.title)
                        .font(.body.weight(.semibold))
                        .tracking(-0.2)
                        .foregroundStyle(.primary)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                    if sizing.rowDescriptions, !snapshot.description.isEmpty {
                        Text(snapshot.description)
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
            .cardHeadlineAccessibility(article: article, title: snapshot.title)
            CardFooter(article: article, snapshot: snapshot, onPhoto: false)
        }
        .padding(.vertical, Tokens.Space.row)
        .background(Color(.systemBackground).opacity(0.001))
        .contentShape(Rectangle())
        .modifier(OpenCard(article: article))
    }
}

extension View {
    /// The headline block of a card reads as one button ("Preview: <title>") for VoiceOver and
    /// UI tests; the footer's own buttons stay separate (no buttons nested in a button).
    func cardHeadlineAccessibility(article: Article, title: String) -> some View {
        accessibilityElement(children: .combine)
            .accessibilityLabel(L10n.t("card.preview", ["title": title]))
            .accessibilityAddTraits(.isButton)
            .modifier(CardDefaultAction(article: article))
            .accessibilityIdentifier("card-\(article.id)")
    }
}

/// VoiceOver's activate on a card's headline opens the story, like a tap.
struct CardDefaultAction: ViewModifier {
    let article: Article
    @Environment(\.openStory) private var openStory
    @Environment(\.storyList) private var list
    @Environment(\.cardActions) private var actions

    func body(content: Content) -> some View {
        content.accessibilityAction {
            openCard(article, openStory: openStory, list: list, actions: actions)
        }
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
struct CardFooter: View {
    let article: Article
    let snapshot: CardSnapshot
    let onPhoto: Bool
    @Environment(ArticleStateStore.self) private var store: ArticleStateStore?
    @Environment(\.cardActions) private var actions

    var body: some View {
        let reactions = snapshot.reactions
        let tint: Color = onPhoto ? Tokens.Palette.onPhotoSecondary : .secondary
        HStack(spacing: 14) {
            counter("arrow.up", reactions.up, pressed: reactions.myVote == .up, tint: tint, label: L10n.t("card.like"), id: "up") {
                Task { await store?.vote(article, .up) }
            }
            counter("arrow.down", reactions.down, pressed: reactions.myVote == .down, tint: tint, label: L10n.t("card.dislike"), id: "down") {
                Task { await store?.vote(article, .down) }
            }
            if reactions.comments > 0 {
                Label("\(reactions.comments)", systemImage: "bubble.left")
                    .labelStyle(CompactLabel())
                    .captionVoice(tint)
                    .accessibilityLabel(L10n.t("card.comments", ["n": String(reactions.comments)]))
            }
            Spacer(minLength: 8)
            circle(snapshot.isTranslated ? "globe.badge.chevron.backward" : "globe",
                   label: L10n.t(snapshot.isTranslated ? "card.showOriginal" : "card.translate"),
                   busy: snapshot.isTranslating, id: "translate") {
                Task { await store?.toggleTranslation(article) }
            }
            circle(snapshot.isSaved ? "bookmark.fill" : "bookmark",
                   label: L10n.t(snapshot.isSaved ? "card.unsave" : "card.save"), id: "save") {
                Task { await store?.toggleSave(article) }
            }
            circle("arrow.up.right.square", label: L10n.t("card.open"), id: "open") { actions.openOriginal(article) }
        }
        .sensoryFeedback(.selection, trigger: reactions.myVote)
    }

    private func counter(_ symbol: String, _ count: Int, pressed: Bool, tint: Color, label: String, id: String,
                         action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            Label("\(count)", systemImage: symbol)
                .labelStyle(CompactLabel())
                .captionVoice(pressed ? (onPhoto ? Color.white : Color.accentColor) : tint)
                .frame(minWidth: 30, minHeight: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(String(count))
        .accessibilityAddTraits(pressed ? .isSelected : [])
        .accessibilityIdentifier("card-\(article.id)-\(id)")
    }

    private func circle(_ symbol: String, label: String, busy: Bool = false, id: String,
                        action: @escaping @MainActor () -> Void) -> some View {
        Button(action: action) {
            ZStack {
                if busy {
                    ProgressView().controlSize(.small).tint(onPhoto ? .white : .secondary)
                } else {
                    Image(systemName: symbol)
                        .font(.system(size: onPhoto ? 15 : 13, weight: .semibold))
                        .foregroundStyle(onPhoto ? Color.white : Color.secondary)
                }
            }
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
        .accessibilityIdentifier("card-\(article.id)-\(id)")
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
