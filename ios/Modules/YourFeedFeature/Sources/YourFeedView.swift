import ArticleKit
import CoreModels
import DesignSystem
import Persistence
import SwiftUI

/// Your Feed: the taste onboarding deck until five stories are rated, then the stories ranked for
/// the reader (web: the Your Feed tab's Recommended sub-tab; Saved is a tab of its own here).
public struct YourFeedView: View {
    @Bindable private var store: YourFeedStore
    @Environment(\.cardSizing) private var sizing

    public init(store: YourFeedStore) {
        self.store = store
    }

    public var body: some View {
        Group {
            switch store.phase {
            case .onboarding:
                OnboardingDeck(store: store)
            case .idle, .loading, .recommended, .failed:
                recommended
            }
        }
        .background { AmbientBackground(hues: store.hues) }
        .navigationTitle(L10n.t("cat.saved"))
        // the deck has a title of its own: the bar stays small while it is up
        .toolbarTitleDisplayMode(store.phase == .onboarding ? .inline : .automatic)
        .task { await store.appear() }
    }

    private var recommended: some View {
        let items = FeedLayout.items(for: store.recommended, withHero: true)
        return GeometryReader { geometry in
            let columns = FeedLayout.columns(forWidth: geometry.size.width, cardMin: sizing.cardMin)
            let gutter: CGFloat = columns == 1 ? Tokens.Space.page : 24
            ScrollView {
                LazyVStack(spacing: 0) {
                    switch store.phase {
                    case .failed(let offline):
                        VStack(spacing: 14) {
                            Label(L10n.t("feed.error"), systemImage: offline ? "wifi.slash" : "exclamationmark.triangle")
                                .font(.headline)
                            Text(L10n.t("feed.errorHint")).font(.subheadline).foregroundStyle(.secondary)
                            Button(L10n.t("feed.retry")) { Task { await store.reload() } }
                                .buttonStyle(.glass)
                        }
                        .multilineTextAlignment(.center)
                        .padding(.top, 60)
                        .padding(.horizontal, gutter)
                    case .recommended where items.isEmpty:
                        ContentUnavailableView(L10n.t("feed.empty"), systemImage: "newspaper", description: Text(L10n.t("feed.emptyHint")))
                            .padding(.top, 60)
                    case .recommended:
                        header.padding(.horizontal, gutter).padding(.bottom, 10)
                        ForEach(FeedLayout.blocks(items, columns: columns)) { block in
                            FeedBlockView(block: block, columns: columns, width: geometry.size.width, gutter: gutter)
                                .id(block.id)
                        }
                    case .idle, .loading, .onboarding:
                        ForEach(0..<5, id: \.self) { _ in SkeletonRow().padding(.horizontal, gutter) }
                    }
                }
                .padding(.bottom, 24)
            }
            .refreshable { await store.loadRecommended() }
            .environment(\.storyList, StoryListRef(store))
        }
    }

    /// "Tune more": another round of five (web `#tuneMore`).
    private var header: some View {
        HStack(spacing: 10) {
            Text(L10n.t("feed.subRecommended")).captionVoice(.secondary)
            Spacer(minLength: 8)
            GlassChip(L10n.t("feed.tune"), systemImage: "slider.horizontal.3", isSelected: false) {
                Task { await store.startOnboarding() }
            }
            .accessibilityIdentifier("tune-more")
        }
        .padding(.top, 4)
    }
}

// MARK: - Onboarding

/// One story on stage (web onboarding.js): drag right to like, left to skip — or the buttons, or
/// ←/→ with a keyboard. The card follows the finger 1:1 with a slight tilt; LIKE / SKIP stamps
/// fade in with the distance; past 80 pt it flies off, short of it springs back.
struct OnboardingDeck: View {
    let store: YourFeedStore
    @Environment(ArticleStateStore.self) private var states
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drag: CGSize = .zero
    @State private var flying = false

    static let commitDistance: CGFloat = 80

    var body: some View {
        GeometryReader { geometry in
            // the card takes what the title, the progress and the buttons leave (4:5 at most)
            let width = min(geometry.size.width - 2 * Tokens.Space.page, 440)
            let height = min(width * 1.25, max(300, geometry.size.height - 250))
            ScrollView {
                VStack(spacing: 18) {
                    VStack(spacing: 6) {
                        Text(L10n.t("onboard.title"))
                            .heavyTitle(26, relativeTo: .title2)
                            .multilineTextAlignment(.center)
                        Text(L10n.t("onboard.hint"))
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.horizontal, Tokens.Space.page)
                    progress
                    stage(width: width, height: height)
                    buttons
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("onboard")
    }

    private var progress: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                ForEach(0..<store.batchTotal, id: \.self) { index in
                    Capsule()
                        .fill(index < store.batchDone ? AnyShapeStyle(Tokens.Palette.ai) : AnyShapeStyle(.quaternary))
                        .frame(width: index < store.batchDone ? 18 : 8, height: 8)
                }
            }
            .animation(.snappy, value: store.batchDone)
            .accessibilityHidden(true)
            Text(L10n.t("onboard.progress", ["done": String(store.batchDone), "total": String(store.batchTotal)]))
                .captionVoice(.secondary)
                .accessibilityIdentifier("onboard-progress")
        }
    }

    @ViewBuilder
    private func stage(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            switch store.deck {
            case .loading:
                RoundedRectangle(cornerRadius: Tokens.Radius.poster, style: .continuous)
                    .fill(.fill.tertiary)
                    .overlay { ProgressView() }
            case .empty, .failed:
                VStack(spacing: 12) {
                    Text(L10n.t("onboard.empty"))
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .accessibilityIdentifier("onboard-empty")
                    Button(L10n.t("feed.retry")) { Task { await store.startOnboarding() } }
                        .buttonStyle(.glass)
                }
                .padding(24)
            case .ready:
                if let article = store.card {
                    OnboardingCard(article: article, live: states.live(article), drag: drag)
                        .id(article.id) // a new story is a new card: it swaps itself in
                        .offset(x: drag.width, y: drag.height * 0.25)
                        .rotationEffect(.degrees(reduceMotion ? 0 : Double(drag.width) * 0.05))
                        .gesture(dragGesture)
                        .accessibilityAction(named: L10n.t("onboard.like")) { commit(1) }
                        .accessibilityAction(named: L10n.t("onboard.skip")) { commit(-1) }
                }
            }
        }
        .frame(width: width, height: height)
    }

    private var buttons: some View {
        HStack(spacing: 28) {
            Button { commit(-1) } label: {
                Image(systemName: "xmark").font(.title2.weight(.bold)).frame(width: 64, height: 64)
            }
            .keyboardShortcut(.leftArrow, modifiers: [])
            .accessibilityLabel(L10n.t("onboard.skip"))
            .accessibilityIdentifier("onboard-skip")
            Button { commit(1) } label: {
                Image(systemName: "heart.fill").font(.title2.weight(.bold)).frame(width: 64, height: 64)
                    .foregroundStyle(Tokens.Palette.live)
            }
            .keyboardShortcut(.rightArrow, modifiers: [])
            .accessibilityLabel(L10n.t("onboard.like"))
            .accessibilityIdentifier("onboard-like")
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .disabled(store.card == nil || flying)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard !flying else { return }
                drag = value.translation
            }
            .onEnded { value in
                guard !flying else { return }
                if abs(value.translation.width) >= Self.commitDistance {
                    commit(value.translation.width > 0 ? 1 : -1, dy: value.translation.height)
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.65)) { drag = .zero }
                }
            }
    }

    /// The card flies off the way it was rated, then the next one swaps in (web `commit`). The
    /// swap itself is instant — the rated card is off screen by then — and the new card animates
    /// its own entrance.
    private func commit(_ dir: Int, dy: CGFloat = 0) {
        guard store.card != nil, !flying else { return }
        flying = true
        let swap = {
            var instant = Transaction()
            instant.disablesAnimations = true
            withTransaction(instant) {
                drag = .zero
                store.rate(dir)
            }
            flying = false
        }
        if reduceMotion {
            swap()
            return
        }
        withAnimation(.easeIn(duration: 0.24)) {
            drag = CGSize(width: CGFloat(dir) * 700, height: dy + 40)
        } completion: {
            swap()
        }
    }
}

/// The staged story: a poster of the photo (or the source's tile) with the byline, headline and
/// description over it — in the reader's language when auto-translation is on (web `applyTranslation`).
struct OnboardingCard: View {
    let article: Article
    let live: ArticleLiveState
    let drag: CGSize
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Tokens.Radius.poster, style: .continuous)
        let title = live.translation?.title ?? article.title
        let description = live.translation?.description ?? article.description
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: article.image, minimumPixelWidth: 400) {
                SourceTile(sourceID: article.source.id, sourceName: article.source.name, letterScale: 0.4, letterOffset: -0.16)
            }
            LinearGradient(
                stops: [.init(color: .black.opacity(0.05), location: 0.25), .init(color: Tokens.Palette.photoFade(scheme), location: 1)],
                startPoint: .top, endPoint: .bottom
            )
            VStack(alignment: .leading, spacing: 8) {
                Dateline(article: article, onPhoto: true)
                Text(title)
                    .heavyTitle(24, relativeTo: .title2)
                    .foregroundStyle(.white)
                    .lineLimit(5)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("onboard-title")
                if !description.isEmpty {
                    Text(description)
                        .font(.subheadline)
                        .foregroundStyle(Tokens.Palette.onPhotoSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let category = NewsCategory(rawValue: article.category), category != .all {
                    Text(category.label).captionVoice(Tokens.Palette.onPhotoSecondary)
                }
            }
            .padding(20)
            stamps
        }
        .clipShape(shape)
        .contentShape(shape)
        .shadow(color: .black.opacity(scheme == .dark ? 0.5 : 0.2), radius: 18, y: 12)
        .scaleEffect(entered || reduceMotion ? 1 : 0.94)
        .opacity(entered ? 1 : 0)
        .onAppear { withAnimation(.snappy(duration: 0.32)) { entered = true } }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("onboard-card")
    }

    /// LIKE on the left as it moves right, SKIP on the right as it moves left.
    private var stamps: some View {
        let like = min(1, max(0, drag.width) / 100)
        let skip = min(1, max(0, -drag.width) / 100)
        return ZStack(alignment: .top) {
            Stamp(text: L10n.t("onboard.like"), color: .green)
                .rotationEffect(.degrees(-12))
                .opacity(like)
                .frame(maxWidth: .infinity, alignment: .leading)
            Stamp(text: L10n.t("onboard.skip"), color: .red)
                .rotationEffect(.degrees(12))
                .opacity(skip)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(24)
        .frame(maxHeight: .infinity, alignment: .top)
        .accessibilityHidden(true)
    }
}

private struct Stamp: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 26, weight: .heavy))
            .tracking(1.5)
            .foregroundStyle(color)
            .padding(.horizontal, 12)
            .padding(.vertical, 4)
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(color, lineWidth: 3.5))
            .background(.black.opacity(0.18), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}
