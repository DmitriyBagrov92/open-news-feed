import AppFeature
import AppleAI
import Dependencies
import Intelligence
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
    /// Shows the system's language download sheet when the reader asks for a new language.
    private let translations: TranslationBroker

    init() {
        var scheme: ColorScheme?
        var route: String?
        let translations = TranslationBroker()
        self.translations = translations
        #if DEBUG
        let configuration = UITestConfiguration.fromProcess()
        route = configuration?.initialRoute
        #endif
        prepareDependencies {
            $0.onDeviceTranslation = .apple(broker: translations)
            $0.languageModel = .apple()
            #if DEBUG
            configuration?.apply(to: &$0) // fakes everywhere, the on-device translator included
            #endif
        }
        #if DEBUG
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
                .modifier(TranslationHost(broker: translations))
        }
    }
}
