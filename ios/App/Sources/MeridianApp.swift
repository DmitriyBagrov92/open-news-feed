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
    private let initialRoute: String?

    init() {
        var scheme: ColorScheme?
        var route: String?
        #if DEBUG
        if let configuration = UITestConfiguration.fromProcess() {
            prepareDependencies { configuration.apply(to: &$0) }
            route = configuration.initialRoute
        }
        switch ProcessInfo.processInfo.environment[LaunchContract.Env.appearance] {
        case "dark": scheme = .dark
        case "light": scheme = .light
        default: scheme = nil
        }
        #endif
        colorScheme = scheme
        initialRoute = route
    }

    var body: some Scene {
        WindowGroup {
            RootView(initialRoute: initialRoute)
                .preferredColorScheme(colorScheme)
        }
    }
}
