import Testing
import ArticleKit

@Suite("ArticleKit module")
struct ArticleKitSmokeTests {
    @Test("links") func links() { _ = ArticleKitModule.self }
}
