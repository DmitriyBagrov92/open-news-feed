import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import FeedFeature
import Foundation
import Intelligence
import Networking
import Persistence
import Testing
import TestSupport

/// The App Store newsroom (Tests/Newsroom, scripts/newsroom.mjs) keeps working as the app changes:
/// the FixtureServer serves it, nothing in it names a real outlet, every photo is credited, and the
/// scripted model (FAKE_MODEL=showcase) still gets the brief, the key points and four forecasts
/// past the app's own checks — the screenshots show what the app really does with such answers.
@MainActor
@Suite("The App Store newsroom", .serialized)
struct NewsroomIntegrationTests {
    private let directory = URL(fileURLWithPath: LaunchContract.newsroomDirectory())

    @Test("it loads like the fixtures: invented outlets, credited photographs, full text, a conversation, three battles")
    func loads() async throws {
        let server = try FixtureServer(directory: directory)
        let feed = server.news(NewsQuery(pageSize: 100))
        #expect(feed.articles.count == 35)
        let credits = try String(contentsOf: directory.appendingPathComponent("CREDITS.md"), encoding: .utf8)
        for article in feed.articles {
            #expect(article.url.host()?.hasSuffix(".example") == true, "\(article.source.name) is not an invented outlet")
            if let image = article.image {
                #expect(credits.contains("`\(image.lastPathComponent)`"), "\(image.lastPathComponent) has no credit")
            }
        }
        let storyA = try #require(feed.articles.first { $0.url.path().hasSuffix("/fixture/story-a") })
        let body = try await server.client.article(storyA.url)
        #expect((body.blocks ?? []).count >= 6)
        let thread = try await server.client.comments(CommentsQuery(articleID: storyA.id))
        #expect(thread.comments.count == 4 && thread.comments.contains { $0.mine })
        let battles = try await server.client.battles().battles
        #expect(battles.count == 3)
        #expect(battles.allSatisfy { battle in Set(battle.articles.compactMap(\.lean)) == [.left, .center, .right] })
    }

    @Test("the scripted model writes the brief and the key points on the device, and Ahead keeps four forecasts")
    func showcase() async throws {
        let server = try FixtureServer(directory: directory)
        try await withDependencies {
            $0.meridianAPI = server.client
            $0.date = .constant(server.capturedAt.date)
            $0.continuousClock = ContinuousClock()
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
            $0.languageModel = .showcase(script: directory.appendingPathComponent("ai.json"))
        } operation: {
            let preferences = PreferencesStore()
            let toasts = ToastCenter()
            let states = ArticleStateStore(library: LibraryModel(), preferences: preferences, toasts: toasts)
            let feed = FeedStore(category: .all, search: false, preferences: preferences, sources: SourcesModel(), states: states, toasts: toasts)
            await feed.reload()
            // the brief runs itself after the load (a manual run would be overtaken by it)
            let briefDeadline = Date().addingTimeInterval(5)
            while Date() < briefDeadline, feed.isBriefThinking || feed.brief.isEmpty { try await Task.sleep(for: .milliseconds(50)) }
            #expect(feed.briefProvider == "on-device")
            #expect(feed.brief.count == 6 && feed.brief.first?.hasPrefix("Storm Idris is due") == true)

            @Dependency(\.summarizer) var summarizer
            let storyA = try #require(feed.items.map(\.article).first { $0.url.path().hasSuffix("/fixture/story-a") })
            let body = try await server.client.article(storyA.url)
            let points = await summarizer.article(storyA.title, body.text, "en")
            #expect(points.provider == "on-device")
            #expect(TextKit.toBullets(points.summary).count == 5)

            let forecast = ForecastStore()
            forecast.open(feed)
            let deadline = Date().addingTimeInterval(5)
            while Date() < deadline { if case .shown = forecast.phase { break }; try await Task.sleep(for: .milliseconds(50)) }
            guard case .shown(let entry) = forecast.phase else {
                Issue.record("no forecast: \(forecast.phase)")
                return
            }
            #expect(entry.provider == "on-device")
            #expect(entry.forecasts.count == ForecastKit.count, "the strict sanitizer dropped a scripted forecast")
            let ids = Set(feed.items.map(\.id))
            #expect(entry.forecasts.allSatisfy { !$0.basis.isEmpty && $0.basis.allSatisfy(ids.contains) })
        }
    }
}
