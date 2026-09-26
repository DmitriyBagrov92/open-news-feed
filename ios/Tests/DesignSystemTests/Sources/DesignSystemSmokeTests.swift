import Testing
import DesignSystem

@Suite("DesignSystem module")
struct DesignSystemSmokeTests {
    @Test("links") func links() { _ = DesignSystemModule.self }
}
