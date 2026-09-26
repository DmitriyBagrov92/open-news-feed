import Testing
import Intelligence

@Suite("Intelligence module")
struct IntelligenceSmokeTests {
    @Test("links") func links() { _ = IntelligenceModule.self }
}
