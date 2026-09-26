import Foundation

/// The Meridian HTTP client: typed endpoints of docs/ARCHITECTURE.md, the error envelope,
/// the anonymous author identity (Keychain) and reachability. Filled in P2 (see ios/CLAUDE.md).
public enum NetworkingModule {
    /// Production origin; builds read `MeridianAPIBaseURL` from Info.plist.
    public static let defaultBaseURL = URL(string: "https://meridi.info")!
}

/// The site's pages the apps link to: the community rules, the privacy policy, support.
public enum MeridianLinks {
    public static var site: URL {
        (Bundle.main.object(forInfoDictionaryKey: "MeridianAPIBaseURL") as? String)
            .flatMap(URL.init(string:)) ?? NetworkingModule.defaultBaseURL
    }

    public static var terms: URL { site.appendingPathComponent("terms") }
    public static var privacy: URL { site.appendingPathComponent("privacy") }
    public static var support: URL { site.appendingPathComponent("support") }
}
