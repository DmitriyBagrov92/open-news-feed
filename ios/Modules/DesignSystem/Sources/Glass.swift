import SwiftUI

/// The page is never flat white or flat black (web `body::before`): three wide, very soft colour
/// fields behind the content, hued from the stories in view (`AmbientPalette`), cross-fading
/// over 1.4 s when the feed changes. Pure gradients — no blur, no animation at rest.
public struct AmbientBackground: View {
    private let hues: [Int]
    @Environment(\.colorScheme) private var scheme

    public init(hues: [Int]) {
        self.hues = hues.count >= 3 ? Array(hues.prefix(3)) : [214, 268, 190]
    }

    public var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let dark = scheme == .dark
            let lightness = dark ? 0.52 : 0.62
            let alphas = dark ? [0.26, 0.20, 0.17] : [0.20, 0.15, 0.13]
            ZStack {
                Color(.systemBackground)
                bloom(hue: hues[0], saturation: 0.88, lightness: lightness, alpha: alphas[0], stop: 0.62,
                      width: size.width * 0.90 * 2, height: size.height * 0.62 * 2, at: CGPoint(x: size.width * 0.08, y: size.height * -0.12))
                bloom(hue: hues[1], saturation: 0.85, lightness: lightness, alpha: alphas[1], stop: 0.62,
                      width: size.width * 0.72 * 2, height: size.height * 0.56 * 2, at: CGPoint(x: size.width * 0.98, y: size.height * 0.04))
                bloom(hue: hues[2], saturation: 0.85, lightness: lightness, alpha: alphas[2], stop: 0.64,
                      width: size.width * 0.96 * 2, height: size.height * 0.60 * 2, at: CGPoint(x: size.width * 0.44, y: size.height * 1.06))
            }
        }
        .ignoresSafeArea()
        .animation(.easeOut(duration: 1.4), value: hues)
        .accessibilityHidden(true)
    }

    /// CSS `radial-gradient(<w> <h> at <x> <y>, hsl(…), transparent <stop>)` — radii are w/2, h/2.
    private func bloom(hue: Int, saturation: Double, lightness: Double, alpha: Double, stop: Double,
                       width: CGFloat, height: CGFloat, at center: CGPoint) -> some View {
        EllipticalGradient(
            stops: [
                .init(color: Color(hue: Double(hue), saturation: saturation, lightness: lightness, opacity: alpha), location: 0),
                .init(color: Color(hue: Double(hue), saturation: saturation, lightness: lightness, opacity: 0), location: stop),
            ],
            center: .center
        )
        .frame(width: width, height: height)
        .position(center)
    }
}

/// A category / filter chip: a Liquid Glass capsule; the selected chip inverts (the web's active
/// chip is label-coloured with background-coloured text).
public struct GlassChip: View {
    private let title: String
    private let systemImage: String?
    private let isSelected: Bool
    private let action: () -> Void

    public init(_ title: String, systemImage: String? = nil, isSelected: Bool, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.isSelected = isSelected
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).imageScale(.small) }
                Text(title)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(isSelected ? Color(.systemBackground) : Color.primary)
            .padding(.horizontal, 15)
            .frame(minHeight: 36)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .glassEffect(isSelected ? .regular.tint(.primary).interactive() : .regular.interactive(), in: .capsule)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

/// A small uppercase badge ("ON-DEVICE AI", "LOCAL DIGEST", "SPECULATIVE").
public struct Badge: View {
    private let text: String
    private let tint: Color

    public init(_ text: String, tint: Color = .secondary) {
        self.text = text
        self.tint = tint
    }

    public var body: some View {
        Text(text)
            .captionVoice(tint)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}
