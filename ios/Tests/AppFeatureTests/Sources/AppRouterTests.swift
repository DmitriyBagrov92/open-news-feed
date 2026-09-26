import AppFeature
import ArticleKit
import CoreModels
import Foundation
import Testing

@MainActor
@Suite("Story navigation")
struct AppRouterTests {
    private func article(_ id: String) -> Article {
        Article(id: id, title: "Story \(id)", description: "", url: URL(string: "https://example.com/\(id)")!, image: nil,
                source: ArticleSource(id: "bbc-world", name: "BBC World", provenance: .unknown), category: "world",
                publishedAt: Timestamp(milliseconds: 0))
    }

    @Test("a story is pushed on compact width and shown in the pane on regular width")
    func open() {
        let router = AppRouter()
        let a = article("a")
        router.open(StoryRoute(article: a, context: [a]), on: .today, regular: false)
        #expect(router.paths[.today]?.map(\.articleID) == ["a"])
        #expect(router.panes.isEmpty)
        let b = article("b")
        router.open(StoryRoute(article: b, context: [a, b]), on: .saved, regular: true)
        #expect(router.panes[.saved]?.articleID == "b")
        #expect(router.paths[.saved] == nil)
    }

    @Test("the pane and the pushed story follow the window across size classes")
    func adapt() {
        let router = AppRouter()
        let a = article("a")
        let route = StoryRoute(article: a, context: [a])
        router.open(route, on: .today, regular: true)
        router.adapt(regular: false)
        #expect(router.panes.isEmpty)
        #expect(router.paths[.today] == [route])
        router.adapt(regular: true)
        #expect(router.paths.isEmpty)
        #expect(router.panes[.today] == route)
    }

    @Test("a route falls back to the story alone when the context lacks it")
    func route() {
        let a = article("a")
        let b = article("b")
        let route = StoryRoute(article: a, context: [b])
        #expect(route.context.map(\.id) == ["a"])
        #expect(route.article?.id == "a")
        #expect(StoryRoute(article: a, context: [a, b]) != StoryRoute(article: a, context: [a, b]), "every opening is its own route")
    }
}
