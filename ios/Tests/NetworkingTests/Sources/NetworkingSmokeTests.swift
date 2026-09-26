import Testing
import Networking

@Suite("Networking module")
struct NetworkingSmokeTests {
    @Test("links and points at production by default")
    func productionOrigin() {
        #expect(NetworkingModule.defaultBaseURL.host() == "meridi.info")
    }
}
