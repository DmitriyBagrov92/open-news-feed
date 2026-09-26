import Testing
import AppFeature
import TestSupport

@Suite("App integration")
struct AppIntegrationSmokeTests {
    @Test("the composition modules link together") func links() {
        _ = AppFeatureModule.self
        _ = TestSupportModule.self
    }
}
