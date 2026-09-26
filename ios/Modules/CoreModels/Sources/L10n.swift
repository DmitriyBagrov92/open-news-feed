import Foundation

/// The web's `t(key, vars)` (public/js/i18n.js): a String Catalog lookup keyed by the web's i18n
/// keys, `{name}` placeholders replaced, the key itself when a string is missing. The catalog
/// (Resources/Localizable.xcstrings) is generated from the web table by ios/scripts/sync-strings.mjs,
/// so both clients speak the same copy; iOS-only strings live in Resources/strings-ios.json.
public enum L10n {
    public static func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        var value = bundle.localizedString(forKey: key, value: key, table: nil)
        for (name, replacement) in vars {
            value = value.replacingOccurrences(of: "{\(name)}", with: replacement)
        }
        return value
    }

    /// The CoreModels framework bundle, which carries the catalog.
    public static let bundle = Bundle(for: BundleToken.self)
}

private final class BundleToken {}
