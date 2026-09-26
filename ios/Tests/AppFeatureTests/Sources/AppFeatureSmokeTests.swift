import Testing
import AppFeature

@Suite("AppFeature module")
struct AppFeatureSmokeTests {
    @Test("links") func links() { _ = AppFeatureModule.self }
}
