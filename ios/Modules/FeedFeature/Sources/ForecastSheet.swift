import ArticleKit
import CoreModels
import DesignSystem
import Intelligence
import SwiftUI

/// The Ahead sheet (web `#forecast`): the speculative label on everything, skeletons while the
/// model drafts, four forecast cards — tap one for the model's reasoning, a chip for the real
/// story it builds on. Never mixed into the feed: a forecast is not a story (web `.fcard` outside
/// `#grid`).
public struct ForecastSheet: View {
    private let store: ForecastStore
    private let feed: FeedStore
    private let isRegular: Bool
    private let openStory: (Article) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.clockNow) private var now
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - isRegular: the window is wide (iPad): the sheet opens at its full height at once.
    ///   - openStory: a basis chip was tapped — the sheet is already closing.
    public init(store: ForecastStore, feed: FeedStore, isRegular: Bool = false, openStory: @escaping (Article) -> Void) {
        self.store = store
        self.feed = feed
        self.isRegular = isRegular
        self.openStory = openStory
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    content
                }
                // skeletons give way to the cards (web animateIn), without motion when it is reduced
                .animation(reduceMotion ? nil : .smooth(duration: 0.35), value: store.phase)
                .padding(.horizontal, 20)
                .padding(.top, 4)
                .padding(.bottom, 28)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("forecast")
            }
            .navigationTitle(L10n.t("ios.ahead.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .close) { dismiss() }
                        .accessibilityLabel(L10n.t("forecast.close"))
                        .accessibilityIdentifier("forecast-close")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { store.run(feed) } label: { Image(systemName: "arrow.clockwise") }
                        .disabled(store.phase == .thinking)
                        .accessibilityLabel(L10n.t("forecast.regenerate"))
                        .accessibilityIdentifier("forecast-regenerate")
                }
            }
        }
        // a phone starts at half height over the feed; an iPad form sheet has no room to spare
        .presentationDetents(isRegular ? [.large] : [.medium, .large])
        .onDisappear { store.close() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L10n.t("forecast.label")).captionVoice(Tokens.Palette.ai)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Badge(L10n.t("forecast.specTag"), tint: Tokens.Palette.ai)
                Text(L10n.t("forecast.disclaimer"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            status
        }
    }

    @ViewBuilder
    private var status: some View {
        switch store.phase {
        case .thinking:
            Text(L10n.t("forecast.thinking")).captionVoice(.secondary)
                .accessibilityIdentifier("forecast-status")
        case .shown(let entry):
            HStack(spacing: 8) {
                Text(L10n.t("forecast.generated") + " · " + RelativeTime.relTime(entry.generatedAt, now: now))
                    .captionVoice(.secondary)
                    .accessibilityIdentifier("forecast-status")
                Badge(TextKit.providerLabel(entry.provider)
                      + (entry.language != feed.targetLanguage ? " · " + entry.language.uppercased() : ""),
                      tint: Tokens.Palette.ai)
                    .accessibilityIdentifier("forecast-badge")
            }
        case .idle, .note:
            EmptyView()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .idle, .thinking:
            ForEach(0..<ForecastKit.count, id: \.self) { _ in ForecastSkeleton() }
        case .shown(let entry):
            ForEach(Array(entry.forecasts.enumerated()), id: \.offset) { _, forecast in
                ForecastCard(forecast: forecast, basis: Self.basis(forecast, in: entry), now: now) { article in
                    dismiss()
                    openStory(article)
                }
                .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        case .note(let key, let retry):
            VStack(alignment: .leading, spacing: 12) {
                Text(L10n.t(key))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("forecast-note")
                if retry {
                    Button(L10n.t("feed.retry")) { store.run(feed) }
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("forecast-retry")
                }
            }
            .padding(.top, 8)
        }
    }

    /// The chips name the outlet; a second story from the same outlet shows its headline instead
    /// of a duplicate name (web `buildCard`).
    static func basis(_ forecast: Forecast, in entry: ForecastStore.Entry) -> [ForecastCard.Chip] {
        var used = Set<String>()
        return forecast.basis.compactMap { id in
            guard let article = entry.articles[id] else { return nil }
            let source = article.source.name
            let label = !source.isEmpty && !used.contains(source) ? source : article.title
            used.insert(source)
            return ForecastCard.Chip(article: article, label: label)
        }
    }
}

/// One forecast (web `.fcard`): due time and confidence, the headline, the reasoning (two lines
/// until opened), the AI-GENERATED · NOT NEWS badge and the stories it builds on.
struct ForecastCard: View {
    struct Chip: Identifiable {
        let article: Article
        let label: String
        var id: String { article.id }
    }

    let forecast: Forecast
    let basis: [Chip]
    let now: Int64
    let open: (Article) -> Void
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // one line when it fits, the confidence under the due time on a narrow card
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    due
                    Spacer(minLength: 8)
                    confidence
                }
                VStack(alignment: .leading, spacing: 4) {
                    due
                    confidence.padding(.leading, 12)
                }
            }
            Text(forecast.headline)
                .font(.headline)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("fcard-title")
            Text(forecast.why)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(expanded ? nil : 2)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("fcard-why")
            Badge(L10n.t("forecast.badge"))
            if !basis.isEmpty {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    Text(L10n.t("forecast.basedOn")).captionVoice(.secondary)
                    ForEach(basis) { chip in
                        Button { open(chip.article) } label: {
                            Text(chip.label)
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                        }
                        .buttonStyle(.plain)
                        .background(.fill.tertiary, in: Capsule())
                        .accessibilityLabel(L10n.t("forecast.openBasis", ["title": chip.article.title]))
                        .accessibilityIdentifier("fcard-basis-\(chip.article.id)")
                    }
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: Tokens.Radius.panel, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: Tokens.Radius.panel, style: .continuous))
        .onTapGesture { withAnimation(.snappy) { expanded.toggle() } }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("fcard")
        .accessibilityAction(named: L10n.t("forecast.expand")) { expanded.toggle() }
    }

    private var due: some View {
        HStack(spacing: 6) {
            Circle().fill(Tokens.Palette.ai).frame(width: 6, height: 6)
            Text(L10n.t("forecast.tag") + " · " + RelativeTime.relFuture(forecast.dueAt, now: now))
                .captionVoice(Tokens.Palette.ai)
                .lineLimit(1)
        }
    }

    private var confidence: some View {
        Text(L10n.t(forecast.confidence == "medium" ? "forecast.confMedium" : "forecast.confLow"))
            .captionVoice(forecast.confidence == "medium" ? AnyShapeStyle(Tokens.Palette.ai) : AnyShapeStyle(.secondary))
            .lineLimit(1)
    }
}

/// A card-shaped placeholder while the model thinks (web `.fcard--skeleton`).
struct ForecastSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 6) {
                Circle().fill(Tokens.Palette.ai.opacity(0.5)).frame(width: 6, height: 6)
                Capsule().fill(.quaternary).frame(width: 90, height: 8)
            }
            ThinkingBars()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.fill.quaternary, in: RoundedRectangle(cornerRadius: Tokens.Radius.panel, style: .continuous))
        .accessibilityHidden(true)
    }
}
