import Foundation

/// The Meridian HTTP client: typed endpoints of docs/ARCHITECTURE.md, the error envelope,
/// the anonymous author identity (Keychain) and reachability. Filled in P2 (see ios/CLAUDE.md).
public enum NetworkingModule {
    /// Production origin; builds read `MeridianAPIBaseURL` from Info.plist.
    public static let defaultBaseURL = URL(string: "https://meridi.info")!
}
