import SwiftUI

public extension View {
    /// The web's `.mono` caption voice — datelines, badges, clocks: small, bold, uppercase,
    /// tracked, tabular figures. Scales with Dynamic Type from `caption2`.
    func captionVoice(_ style: some ShapeStyle = .secondary) -> some View {
        font(.caption2.weight(.bold))
            .textCase(.uppercase)
            .tracking(0.66)
            .monospacedDigit()
            .foregroundStyle(style)
    }
}

/// Heavy editorial titles (the web's 800 weight), sized from a base point size but scaled with
/// Dynamic Type relative to the given text style.
public struct HeavyTitle: ViewModifier {
    @ScaledMetric private var size: CGFloat
    private let weight: Font.Weight
    private let tracking: CGFloat

    public init(size: CGFloat, relativeTo style: Font.TextStyle = .title, weight: Font.Weight = .heavy, tracking: CGFloat = -0.02) {
        _size = ScaledMetric(wrappedValue: size, relativeTo: style)
        self.weight = weight
        self.tracking = tracking
    }

    public func body(content: Content) -> some View {
        content
            .font(.system(size: size, weight: weight))
            .tracking(size * tracking)
    }
}

public extension View {
    func heavyTitle(_ size: CGFloat, relativeTo style: Font.TextStyle = .title, weight: Font.Weight = .heavy) -> some View {
        modifier(HeavyTitle(size: size, relativeTo: style, weight: weight))
    }
}
