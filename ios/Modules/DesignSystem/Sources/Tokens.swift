import SwiftUI

/// Meridian's native tokens — the web's CSS custom properties (public/css/styles.css) mapped onto
/// iOS semantics. Colours are system colours (the web's tokens are Apple's to begin with), so light,
/// dark, Increase Contrast and Reduce Transparency come from the platform.
public enum Tokens {
    public enum Radius {
        /// `--r-poster` — hero and wide posters.
        public static let poster: CGFloat = 28
        /// `--r-card` / `--r-thumb`.
        public static let card: CGFloat = 22
        public static let thumb: CGFloat = 18
        /// The brief / forecast glass cards.
        public static let panel: CGFloat = 26
    }

    public enum Space {
        /// Page gutter on compact width (`--pad` floor).
        public static let page: CGFloat = 16
        /// Row vertical padding (`.card--std`).
        public static let row: CGFloat = 14
    }

    public enum Palette {
        /// The live/breaking voice (`--live`).
        public static let live = Color.red
        /// The AI voice (`--indigo`): brief, forecast, sparkles.
        public static let ai = Color.indigo
        /// Bubble Battle leans.
        public static let leanLeft = Color.indigo
        public static let leanRight = Color.red
        public static let leanCenter = Color.secondary
        /// Stance words as text: 4.5:1 on light and dark glass (the lean reds and greens are for
        /// rings and dots).
        public static let critical = Color(light: Color(red: 0.78, green: 0.16, blue: 0.16), dark: Color(red: 1, green: 0.45, blue: 0.43))
        public static let supportive = Color(light: Color(red: 0.08, green: 0.50, blue: 0.24), dark: Color(red: 0.29, green: 0.87, blue: 0.50))
        /// `--photo-fade`: the bottom of a poster, where the white title sits.
        public static func photoFade(_ scheme: ColorScheme) -> Color { .black.opacity(scheme == .dark ? 0.8 : 0.74) }
        /// `--on-photo-2`.
        public static let onPhotoSecondary = Color.white.opacity(0.78)
    }
}

/// The web's card-size ladder (`gridSize` −2…2, `html[data-grid-size]`).
public struct CardSizing: Sendable, Hashable {
    public let level: Int
    /// `--thumb`: the row thumbnail edge.
    public let thumb: CGFloat
    /// `--card-min`: the narrowest column on regular width.
    public let cardMin: CGFloat
    /// `--poster-title`: hero title size (wide posters use −4).
    public let posterTitle: CGFloat
    /// `--row-h`: the mosaic's row rhythm on regular width (a hero spans 3, a wide poster 2).
    public let rowHeight: CGFloat
    /// Descriptions shown on rows / on posters.
    public let rowDescriptions: Bool
    public let posterDescriptions: Bool

    public init(level: Int) {
        let clamped = min(2, max(-2, level))
        let index = clamped + 2
        self.level = clamped
        thumb = [64, 76, 88, 100, 112][index]
        cardMin = [240, 270, 300, 340, 400][index]
        posterTitle = [20, 23, 26, 29, 32][index]
        rowHeight = [146, 170, 196, 214, 232][index]
        rowDescriptions = clamped >= 0
        posterDescriptions = clamped >= -1
    }

    public static let standard = CardSizing(level: 0)
}

public extension Color {
    /// One colour per appearance (text that must keep its contrast in both).
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }

    /// CSS `hsl()` — hue in degrees, saturation and lightness in 0…1.
    init(hue degrees: Double, saturation: Double, lightness: Double, opacity: Double = 1) {
        let value = lightness + saturation * min(lightness, 1 - lightness)
        let hsbSaturation = value == 0 ? 0 : 2 * (1 - lightness / value)
        let hue = ((degrees.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360) / 360
        self.init(hue: hue, saturation: hsbSaturation, brightness: value, opacity: opacity)
    }
}

public extension Bundle {
    /// DesignSystem's resource bundle (flags).
    static let designSystem = Bundle(for: DesignSystemBundleToken.self)
}

private final class DesignSystemBundleToken {}
