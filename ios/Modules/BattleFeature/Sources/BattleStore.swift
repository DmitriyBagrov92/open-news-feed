import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Observation
import Persistence

/// Bubble Battle (web battle.js): one story covered from more than one lean, clustered by the
/// server. Each cluster explains HOW COVERAGE DIFFERS once it has been in view for a moment —
/// the on-device model's contrast, or the deterministic stance of each side with its receipt.
@MainActor
@Observable
public final class BattleStore {
    public enum Phase: Equatable {
        case idle, loading, loaded, empty, failed
    }

    /// A cluster's HOW COVERAGE DIFFERS.
    public enum Brief: Equatable {
        case thinking
        /// The model's (or the server's) three key points.
        case bullets([String])
        /// The deterministic contrast, one line per lean, in the reader's language.
        case rows([Row])
    }

    public struct Row: Hashable, Sendable {
        public let lean: Lean
        public let source: String
        public let stance: BattleBrief.Stance
        public let stanceText: String
        public let evidence: String?
    }

    public private(set) var phase: Phase = .idle
    public private(set) var battles: [Battle] = []
    public private(set) var updatedAt: Timestamp?
    /// The brief of each cluster that has been seen, by battle id.
    public private(set) var briefs: [String: Brief] = [:]

    @ObservationIgnored private var fetchedAt: Date?
    @ObservationIgnored private var cache: [String: Brief] = [:]
    @ObservationIgnored private var dwell: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var visible: Set<String> = []
    @ObservationIgnored private var running: Set<String> = []

    @ObservationIgnored private let preferences: PreferencesStore
    @ObservationIgnored private let states: ArticleStateStore
    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored @Dependency(\.date) private var date
    @ObservationIgnored @Dependency(\.continuousClock) private var clock
    @ObservationIgnored @Dependency(\.summarizer) private var summarizer
    @ObservationIgnored @Dependency(\.translator) private var translator

    /// Refetched on entry when older than this (web `STALE_MS`).
    static let staleAfter: TimeInterval = 5 * 60
    /// A beat of dwell time, so scrolling past does not summarize everything (web: 700 ms).
    static let dwellTime: Duration = .milliseconds(700)

    public init(preferences: PreferencesStore, states: ArticleStateStore) {
        self.preferences = preferences
        self.states = states
    }

    public func appear() async {
        if let fetchedAt, phase == .loaded || phase == .empty, date.now.timeIntervalSince(fetchedAt) < Self.staleAfter { return }
        await load()
    }

    /// web `ensureData`: hidden sources out; a battle needs two stories and two leans.
    public func load() async {
        if battles.isEmpty { phase = .loading }
        do {
            let response = try await api.battles()
            let hidden = Set(preferences.value.hiddenSources)
            battles = response.battles.compactMap { battle in
                let articles = battle.articles.filter { !hidden.contains($0.source.id) }
                guard articles.count >= 2, Set(articles.compactMap(\.lean)).count >= 2 else { return nil }
                return Battle(id: battle.id, topic: battle.topic, leans: battle.leans, articles: articles)
            }
            updatedAt = response.updatedAt
            fetchedAt = date.now
            phase = battles.isEmpty ? .empty : .loaded
            let ids = Set(battles.map(\.id))
            briefs = briefs.filter { ids.contains($0.key) }
        } catch is CancellationError {
            return
        } catch {
            if battles.isEmpty { phase = .failed }
        }
    }

    /// Hidden sources changed: the clusters are rebuilt.
    public func invalidate() {
        fetchedAt = nil
        guard phase != .idle else { return }
        Task { await load() }
    }

    /// The briefs' language: the reader's while auto-translation is on (web `langActive`).
    private var language: String {
        preferences.value.autoTranslate && preferences.value.targetLang != "en" ? preferences.value.targetLang : "en"
    }

    /// A cluster came into view or left it (web `onClusterVisible`): after the dwell its brief runs.
    public func clusterVisible(_ id: String, _ isVisible: Bool) {
        if isVisible {
            visible.insert(id)
            guard dwell[id] == nil, briefs[id] == nil else { return }
            dwell[id] = Task { [weak self, clock] in
                try? await clock.sleep(for: Self.dwellTime)
                guard !Task.isCancelled else { return }
                self?.dwell[id] = nil
                await self?.runBrief(id)
            }
        } else {
            visible.remove(id)
            dwell[id]?.cancel()
            dwell[id] = nil
        }
    }

    /// The language or auto-translation changed: the clusters in view explain themselves again in
    /// the new language (the rest as they come into view).
    public func languageChanged() {
        dwell.values.forEach { $0.cancel() }
        dwell = [:]
        briefs = [:]
        for id in visible { clusterVisible(id, true) }
    }

    /// web `runClusterBrief`: the contrast ladder over lean-labelled headlines; its local rung is
    /// the deterministic stance per side, translated as whole sentences for another language.
    public func runBrief(_ id: String) async {
        guard let battle = battles.first(where: { $0.id == id }) else { return }
        let lang = language
        let key = id + ":" + lang
        if let cached = cache[key] {
            briefs[id] = cached
            return
        }
        guard running.insert(key).inserted else { return }
        defer { running.remove(key) }
        briefs[id] = .thinking
        let items = battle.articles.map {
            DigestItem(title: ($0.lean?.rawValue.uppercased() ?? "") + ": " + $0.title, description: $0.description, source: $0.source.name)
        }
        let result = await summarizer.contrast(items, battle.topic.joined(separator: " "), lang)
        let brief: Brief
        if result.provider == "local" {
            brief = .rows(await rows(for: battle, language: lang))
        } else {
            brief = .bullets(TextKit.toBullets(result.summary, max: 3))
        }
        cache[key] = brief
        guard lang == language else { return } // the language changed meanwhile
        briefs[id] = brief
    }

    private func rows(for battle: Battle, language lang: String) async -> [Row] {
        let who = battle.topic.first ?? ""
        var rows = BattleBrief.contrastRows(battle).map {
            Row(lean: $0.lean, source: $0.source, stance: $0.stance,
                stanceText: L10n.t("battle.\($0.stance.rawValue)", ["who": who]), evidence: $0.evidence)
        }
        guard lang != "en" else { return rows }
        // whole sentences only (the stance and the headline) — fragments mistranslate
        let texts = rows.flatMap { [$0.stanceText, $0.evidence ?? "\u{2014}"] }
        if let translated = await translator.translate(texts, lang, "en", false), translated.texts.count == texts.count {
            rows = rows.enumerated().map { index, row in
                Row(lean: row.lean, source: row.source, stance: row.stance,
                    stanceText: translated.texts[2 * index].isEmpty ? row.stanceText : translated.texts[2 * index],
                    evidence: row.evidence.map { translated.texts[2 * index + 1].isEmpty ? $0 : translated.texts[2 * index + 1] })
            }
        }
        return rows
    }
}
