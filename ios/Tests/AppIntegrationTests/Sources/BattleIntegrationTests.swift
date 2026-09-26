import ArticleKit
import BattleFeature
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Persistence
import Testing
import TestSupport

/// Bubble Battle on the fixture newsroom (web battle.js `ensureData` + `runClusterBrief`): the
/// clusters, and each one's HOW COVERAGE DIFFERS — the model's, or the deterministic contrast.
@MainActor
@Suite("Bubble Battle on the fixture newsroom", .serialized)
struct BattleIntegrationTests {
    private let court = "36fe6a64a99a"   // left 3 · center 1 · right 2
    private let archive = "076dfafdb160" // guardian-world is its only left voice

    @MainActor
    struct World {
        let preferences: PreferencesStore
        let store: BattleStore
    }

    private func world(model: LanguageModelClient = .unavailable, _ body: (World) async throws -> Void) async throws {
        let server = try FixtureServer(directory: Fixtures.root)
        try await withDependencies {
            $0.meridianAPI = server.client
            $0.date = .constant(server.capturedAt.date)
            $0.continuousClock = ContinuousClock()
            $0.library = .swiftData(inMemory: true)
            $0.preferences = .inMemory()
            $0.languageModel = model
        } operation: {
            let preferences = PreferencesStore()
            let library = LibraryModel()
            let states = ArticleStateStore(library: library, preferences: preferences, toasts: ToastCenter())
            try await body(World(preferences: preferences, store: BattleStore(preferences: preferences, states: states)))
        }
    }

    private func eventually(_ seconds: Double = 3, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    @Test("clusters need two stories and two leans; a hidden source can dissolve one")
    func clusters() async throws {
        try await world { world in
            await world.store.appear()
            #expect(world.store.phase == .loaded)
            #expect(world.store.battles.map(\.id) == [court, "eb29377446c9", "036ff418be33", archive])
            #expect(world.store.updatedAt != nil)
            world.preferences.value.hiddenSources = ["guardian-world"]
            await world.store.load()
            #expect(!world.store.battles.map(\.id).contains(archive), "only the center was left")
            let courtBattle = try #require(world.store.battles.first { $0.id == court })
            #expect(!courtBattle.articles.contains { $0.source.id == "guardian-world" })
        }
    }

    @Test("without a model: each side's stance with its receipt, left to right")
    func contrast() async throws {
        try await world { world in
            await world.store.load()
            await world.store.runBrief(court)
            guard case .rows(let rows) = world.store.briefs[court] else {
                Issue.record("\(String(describing: world.store.briefs[court]))")
                return
            }
            #expect(rows.map(\.lean) == [.left, .center, .right])
            #expect(rows.map(\.source) == ["The Guardian, The Nation", "The Hill", "Fox News, New York Post"])
            #expect(rows.map(\.stanceText) == ["neutral, fact-focused", "neutral, fact-focused", "supportive of Supreme Court"])
            #expect(rows[2].evidence == "Supreme Court takes up Trump Tariffs case in win for White House")
        }
    }

    @Test("a reader of another language: the stance and the receipt are translated as whole sentences")
    func translated() async throws {
        try await world { world in
            world.preferences.value.targetLang = "de"
            world.preferences.value.autoTranslate = true
            await world.store.load()
            await world.store.runBrief(court)
            guard case .rows(let rows) = world.store.briefs[court] else {
                Issue.record("\(String(describing: world.store.briefs[court]))")
                return
            }
            #expect(rows[2].stanceText == "[de] supportive of Supreme Court")
            #expect(rows[2].evidence == "[de] Supreme Court takes up Trump Tariffs case in win for White House")
            #expect(rows[0].evidence == nil, "no receipt stays no receipt")
        }
    }

    @Test("with Apple Intelligence: three key points on how the coverage differs")
    func onDevice() async throws {
        try await world(model: .fake("points")) { world in
            await world.store.load()
            await world.store.runBrief(court)
            guard case .bullets(let lines) = world.store.briefs[court] else {
                Issue.record("\(String(describing: world.store.briefs[court]))")
                return
            }
            #expect(lines.count == 3)
            #expect(lines.allSatisfy { $0.hasPrefix("On-device: ") })
            #expect(lines[0].contains(": Supreme Court"), "the headlines carry their lean")
        }
    }

    @Test("a cluster explains itself after a beat in view — not when it is scrolled past")
    func dwell() async throws {
        try await world { world in
            await world.store.load()
            world.store.clusterVisible(court, true)
            #expect(world.store.briefs[court] == nil)
            world.store.clusterVisible(archive, true)
            world.store.clusterVisible(archive, false)
            #expect(await eventually { world.store.briefs[court] != nil && world.store.briefs[court] != .thinking })
            try await Task.sleep(for: .milliseconds(300))
            #expect(world.store.briefs[archive] == nil, "scrolled past within the dwell")
        }
    }

    @Test("a new language: the clusters in view explain themselves again, in it")
    func language() async throws {
        try await world { world in
            await world.store.load()
            world.store.clusterVisible(court, true)
            #expect(await eventually { world.store.briefs[court] != nil && world.store.briefs[court] != .thinking })
            world.preferences.value.targetLang = "de"
            world.preferences.value.autoTranslate = true
            world.store.languageChanged()
            #expect(world.store.briefs[court] == nil)
            #expect(await eventually {
                if case .rows(let rows) = world.store.briefs[court] { rows[2].stanceText.hasPrefix("[de] ") } else { false }
            })
        }
    }
}
