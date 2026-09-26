import AppFeature
import Dependencies
import SwiftUI
#if DEBUG
import TestSupport
#endif

/// Composition root: live dependencies, or — in DEBUG builds launched with `-UITestMode` — the
/// fully faked graph on the fixture newsroom (UI tests, the Demo scheme, screenshots).
@main
struct MeridianApp: App {
    private let colorScheme: ColorScheme?

    init() {
        var scheme: ColorScheme?
        #if DEBUG
        if let configuration = UITestConfiguration.fromProcess() {
            prepareDependencies { configuration.apply(to: &$0) }
        }
        switch ProcessInfo.processInfo.environment[LaunchContract.Env.appearance] {
        case "dark": scheme = .dark
        case "light": scheme = .light
        default: scheme = nil
        }
        #endif
        colorScheme = scheme
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .preferredColorScheme(colorScheme)
        }
    }
}
