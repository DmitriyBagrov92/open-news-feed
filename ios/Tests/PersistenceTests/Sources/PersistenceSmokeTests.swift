import Testing
import Persistence

@Suite("Persistence module")
struct PersistenceSmokeTests {
    @Test("links") func links() { _ = PersistenceModule.self }
}
