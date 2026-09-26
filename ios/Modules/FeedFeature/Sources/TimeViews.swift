import ArticleKit
import CoreModels
import DesignSystem
import SwiftUI

/// The iPad time rail (web `timescale.js`, ≥1000 px) as a scrubber: a slim glass capsule on the
/// trailing edge tinted by story density over the loaded range (NOW at the top), a cursor at the
/// story on top of the viewport; while dragging, a glass label shows the time — release to jump.
struct TimeRail: View {
    let scale: Timescale
    let topID: String?
    let items: [FeedItem]
    let seek: (Double) -> Void
    @Environment(\.clockNow) private var now
    @State private var dragFraction: Double?

    private var topTime: Int64 {
        items.first { $0.id == topID }?.article.publishedAt.milliseconds ?? scale.newest
    }

    var body: some View {
        GeometryReader { geometry in
            let height = geometry.size.height
            let buckets = scale.buckets()
            let peak = Double(max(1, buckets.max() ?? 1))
            let fraction = dragFraction ?? scale.fraction(of: topTime)
            ZStack(alignment: .top) {
                Capsule()
                    .fill(.clear)
                    .glassEffect(.regular, in: .capsule)
                LinearGradient(
                    stops: (0..<buckets.count).map { i in
                        let bucket = buckets[buckets.count - 1 - i] // NOW (the newest slice) on top
                        return .init(color: Color.accentColor.opacity(0.12 + Double(bucket) / peak * 0.55),
                                     location: (Double(i) + 0.5) / Double(buckets.count))
                    },
                    startPoint: .top, endPoint: .bottom
                )
                .clipShape(Capsule())
                .padding(4)
                Capsule()
                    .fill(Color.primary)
                    .frame(width: 20, height: 3)
                    .offset(y: max(4, min(height - 7, height * fraction - 1.5)))
            }
            .overlay(alignment: .topTrailing) {
                if let dragFraction {
                    Text(scale.label(forTime: scale.newest - Int64(Double(scale.range) * dragFraction), now: now))
                        .captionVoice(.primary)
                        .fixedSize()
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .glassEffect(.regular, in: .capsule)
                        .offset(x: -40, y: max(0, min(height - 26, height * dragFraction - 13)))
                        .transition(.opacity)
                        .accessibilityIdentifier("time-rail-label")
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in dragFraction = min(1, max(0, value.location.y / height)) }
                    .onEnded { value in
                        seek(min(1, max(0, value.location.y / height)))
                        dragFraction = nil
                    }
            )
            .sensoryFeedback(.selection, trigger: dragFraction.map { Int($0 * 24) })
        }
        .frame(width: 30)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L10n.t("ios.time.rail"))
        .accessibilityValue(scale.label(forTime: topTime, now: now))
        .accessibilityIdentifier("time-rail")
    }
}

/// The phone time chip (web floating chip): the time of the story at the top of the screen in
/// the tab bar's accessory; drag across its density strip to jump through time (NOW on the left).
public struct TimeChip: View {
    private let store: FeedStore
    @Environment(\.clockNow) private var now
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    @State private var dragFraction: Double?

    public init(store: FeedStore) {
        self.store = store
    }

    public var body: some View {
        if let scale = store.timescale {
            let topTime = store.items.first { $0.id == store.topVisibleID }?.article.publishedAt.milliseconds ?? scale.newest
            let label = dragFraction.map { scale.label(forTime: scale.newest - Int64(Double(scale.range) * $0), now: now) }
                ?? scale.label(forTime: topTime, now: now)
            HStack(spacing: 10) {
                Image(systemName: "clock")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text(label)
                    .captionVoice(.primary)
                    .lineLimit(1)
                    .accessibilityIdentifier("time-chip-label")
                if placement != .inline {
                    DensityStrip(buckets: scale.buckets().reversed(), cursor: dragFraction ?? scale.fraction(of: topTime))
                        .frame(height: 18)
                        .overlay {
                            GeometryReader { geometry in
                                Color.clear
                                    .contentShape(Rectangle())
                                    .gesture(
                                        DragGesture(minimumDistance: 0)
                                            .onChanged { value in dragFraction = min(1, max(0, value.location.x / geometry.size.width)) }
                                            .onEnded { value in
                                                let fraction = min(1, max(0, value.location.x / geometry.size.width))
                                                dragFraction = nil
                                                Task { await store.seek(to: fraction) }
                                            }
                                    )
                            }
                        }
                }
            }
            .padding(.horizontal, 16)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("time-chip")
        } else {
            HStack(spacing: 8) {
                Image(systemName: "clock").foregroundStyle(.secondary)
                Text(L10n.t("ios.time.now")).captionVoice(.primary)
            }
            .padding(.horizontal, 16)
        }
    }
}

/// 24 bars of story density, NOW first, with a cursor.
struct DensityStrip: View {
    let buckets: [Int]
    let cursor: Double

    init(buckets: some Sequence<Int>, cursor: Double) {
        self.buckets = Array(buckets)
        self.cursor = cursor
    }

    var body: some View {
        GeometryReader { geometry in
            let peak = Double(max(1, buckets.max() ?? 1))
            let width = geometry.size.width / CGFloat(max(1, buckets.count))
            ZStack(alignment: .bottomLeading) {
                HStack(alignment: .bottom, spacing: 1) {
                    ForEach(Array(buckets.enumerated()), id: \.offset) { _, bucket in
                        RoundedRectangle(cornerRadius: 1)
                            .fill(Color.accentColor.opacity(0.25 + Double(bucket) / peak * 0.6))
                            .frame(width: max(1, width - 1), height: max(2, geometry.size.height * Double(bucket) / peak))
                    }
                }
                Capsule()
                    .fill(Color.primary)
                    .frame(width: 2, height: geometry.size.height)
                    .offset(x: geometry.size.width * cursor)
            }
        }
        .accessibilityHidden(true)
    }
}
