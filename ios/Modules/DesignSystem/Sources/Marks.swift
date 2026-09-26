import CoreModels
import SwiftUI

/// The round publisher flag of a byline (vendored circle-flags), or a globe for a region /
/// international / unknown home — the web's `buildFlag` (country.js).
public struct FlagView: View {
    private let provenance: Provenance
    private let size: CGFloat
    private let ringed: Bool

    public init(_ provenance: Provenance, size: CGFloat = 16, ringed: Bool = false) {
        self.provenance = provenance
        self.size = size
        self.ringed = ringed
    }

    public var body: some View {
        Group {
            if let image = FlagView.image(for: provenance) {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                Image(systemName: "globe")
                    .resizable()
                    .scaledToFit()
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay {
            if ringed { Circle().strokeBorder(.white.opacity(0.5), lineWidth: 0.5) }
        }
        .accessibilityHidden(true)
    }

    /// `flag-<cc>` from the DesignSystem catalog (synced from public/flags).
    public static func image(for provenance: Provenance) -> UIImage? {
        guard case .country(let code) = provenance else { return nil }
        return UIImage(named: "flag-\(code.lowercased())", in: .designSystem, with: nil)
    }
}

/// The duotone letter tile shown when a story has no usable image (web `fallbackTile`): a
/// gradient in the source's hue with the source initial.
public struct SourceTile: View {
    private let hue: Double
    private let letter: String
    private let letterScale: CGFloat
    private let letterOffset: CGFloat

    /// - Parameters:
    ///   - letterScale: letter height as a fraction of the tile's short side.
    ///   - letterOffset: vertical nudge as a fraction of the height (posters lift the letter above the title).
    public init(sourceID: String, sourceName: String, letterScale: CGFloat = 0.42, letterOffset: CGFloat = 0) {
        let key = sourceID.isEmpty ? (sourceName.isEmpty ? "?" : sourceName) : sourceID
        hue = Double(SourceHue.hue(for: key))
        letter = sourceName.first.map { String($0) } ?? "?"
        self.letterScale = letterScale
        self.letterOffset = letterOffset
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                LinearGradient(
                    colors: [Color(hue: hue, saturation: 0.42, lightness: 0.46), Color(hue: hue + 30, saturation: 0.48, lightness: 0.22)],
                    startPoint: .topLeading, endPoint: .bottomTrailing
                )
                RadialGradient(
                    colors: [.white.opacity(0.2), .clear],
                    center: UnitPoint(x: 0.2, y: 0), startRadius: 0, endRadius: max(geometry.size.width, geometry.size.height) * 0.7
                )
                Text(letter)
                    .font(.system(size: min(geometry.size.width, geometry.size.height) * letterScale, weight: .heavy))
                    .foregroundStyle(.white.opacity(0.85))
                    .offset(y: geometry.size.height * letterOffset)
            }
        }
        .accessibilityHidden(true)
    }
}

/// The freshness dot of a dateline: red < 1 h, grey < 6 h, faint otherwise.
public struct FreshnessDot: View {
    private let freshness: Freshness
    private let onPhoto: Bool

    public init(_ freshness: Freshness, onPhoto: Bool = false) {
        self.freshness = freshness
        self.onPhoto = onPhoto
    }

    public var body: some View {
        Circle()
            .fill(fill)
            .frame(width: 6, height: 6)
            .accessibilityHidden(true)
    }

    private var fill: AnyShapeStyle {
        switch freshness {
        case .live: AnyShapeStyle(Tokens.Palette.live)
        case .recent: onPhoto ? AnyShapeStyle(Color.white.opacity(0.78)) : AnyShapeStyle(.secondary)
        case .stale: onPhoto ? AnyShapeStyle(Color.white.opacity(0.45)) : AnyShapeStyle(.tertiary)
        }
    }
}

/// The brand mark: a meridian line through a ring (the wordmark glyph and the App Icon).
public struct MeridianMark: Shape {
    public init() {}

    public func path(in rect: CGRect) -> Path {
        let side = min(rect.width, rect.height)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius = side * 0.34
        var path = Path()
        path.addEllipse(in: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
        path.move(to: CGPoint(x: center.x, y: rect.midY - side / 2))
        path.addLine(to: CGPoint(x: center.x, y: rect.midY + side / 2))
        return path
    }
}

/// Three shimmering bars — the "thinking" state of the brief and the forecast.
public struct ThinkingBars: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = false
    private let widths: [CGFloat]

    public init(widths: [CGFloat] = [0.92, 0.78, 0.56]) {
        self.widths = widths
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(Array(widths.enumerated()), id: \.offset) { index, width in
                GeometryReader { geometry in
                    Capsule()
                        .fill(.quaternary)
                        .overlay {
                            if !reduceMotion {
                                LinearGradient(colors: [.clear, Tokens.Palette.ai.opacity(0.28), .clear], startPoint: .leading, endPoint: .trailing)
                                    .frame(width: geometry.size.width * 0.5)
                                    .offset(x: phase ? geometry.size.width : -geometry.size.width * 0.5)
                                    .animation(.easeInOut(duration: 1.5).repeatForever(autoreverses: false).delay(Double(index) * 0.18), value: phase)
                            }
                        }
                        .clipShape(Capsule())
                        .frame(width: geometry.size.width * width)
                }
                .frame(height: 10)
            }
        }
        .onAppear { phase = true }
        .accessibilityHidden(true)
    }
}
