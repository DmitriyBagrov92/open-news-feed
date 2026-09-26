import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Observation
import Persistence

/// The live, mutable side of one story — counters, saved flag, translation — shared by every
/// surface that shows it (feed card, Saved, search results, later the story view and Battle).
/// Replaces the web's "mirror the result onto the grid card" plumbing.
@MainActor
@Observable
public final class ArticleLiveState {
    public var reactions: Reactions?
    public var isSaved = false
    public var translation: Translation?
    public var isTranslating = false

    public struct Translation: Hashable, Sendable {
        public let language: String
        public let title: String
        public let description: String
    }

    init(reactions: Reactions?, isSaved: Bool) {
        self.reactions = reactions
        self.isSaved = isSaved
    }
}

/// Owns every `ArticleLiveState` and the actions on them. One instance per app.
@MainActor
@Observable
public final class ArticleStateStore {
    @ObservationIgnored private var states: [String: ArticleLiveState] = [:]
    @ObservationIgnored private var votesInFlight: Set<String> = []
    /// Bumped around every vote so a reactions batch that was in flight while a vote changed
    /// counters is dropped rather than undoing the vote (web `voteEpoch`).
    @ObservationIgnored public private(set) var voteEpoch = 0
    /// Bumped when the cards on screen should ask for auto-translation again: the language or the
    /// auto-translate switch changed, or the 75 s back-off after a failure ended (the web
    /// re-observes its cards). Cards key their auto-translate task on it.
    public private(set) var translationEpoch = 0

    // auto-translate batching (web app.js:733-802)
    @ObservationIgnored private var pending: [Article] = []
    @ObservationIgnored private var flushTask: Task<Void, Never>?
    @ObservationIgnored private var translateBroken = false
    @ObservationIgnored private var brokenRetry: Task<Void, Never>?

    @ObservationIgnored private let library: LibraryModel
    @ObservationIgnored private let preferences: PreferencesStore
    @ObservationIgnored private let toasts: ToastCenter
    /// The pause after an auto-translate failure (web: 75 s).
    @ObservationIgnored private let translationBackoff: Duration
    /// Extractions of this session (shared with the story view): a save keeps what was read.
    @ObservationIgnored private let extractions: ExtractionCache
    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored @Dependency(\.translator) private var translator
    @ObservationIgnored @Dependency(\.onDeviceTranslation) private var onDevice
    @ObservationIgnored @Dependency(\.continuousClock) private var clock

    public init(library: LibraryModel, preferences: PreferencesStore, toasts: ToastCenter,
                translationBackoff: Duration = .seconds(75), extractions: ExtractionCache = .shared) {
        self.library = library
        self.preferences = preferences
        self.toasts = toasts
        self.translationBackoff = translationBackoff
        self.extractions = extractions
    }

    /// The live state for a story, created from the story's own counters the first time.
    public func live(_ article: Article) -> ArticleLiveState {
        if let state = states[article.id] {
            if state.reactions == nil, let reactions = article.reactions { state.reactions = reactions }
            return state
        }
        let state = ArticleLiveState(reactions: article.reactions, isSaved: library.contains(article.id))
        states[article.id] = state
        return state
    }

    /// Counters from `GET /api/reactions` (or a feed page), unless a vote happened meanwhile.
    public func applyReactions(_ reactions: [String: Reactions], epoch: Int) {
        guard epoch == voteEpoch else { return }
        for (id, value) in reactions {
            guard let state = states[id], !votesInFlight.contains(id) else { continue }
            if state.reactions != value { state.reactions = value }
        }
    }

    /// Like / dislike (web app.js:163-191): optimistic, a second tap retracts, one request per
    /// story at a time, rolled back with a toast when the server says no.
    public func vote(_ article: Article, _ vote: Vote) async {
        let state = live(article)
        guard !votesInFlight.contains(article.id) else { return }
        votesInFlight.insert(article.id)
        voteEpoch += 1
        defer {
            votesInFlight.remove(article.id)
            voteEpoch += 1
        }
        let previous = state.reactions ?? .zero
        let next: Vote? = previous.myVote == vote ? nil : vote
        state.reactions = Self.optimistic(previous, next)
        do {
            let result = try await api.voteArticle(article.id, next?.rawValue ?? 0)
            state.reactions = Reactions(comments: previous.comments, up: result.up, down: result.down, myVote: result.myVote)
        } catch {
            state.reactions = previous
            toasts.show(L10n.t((error as? APIError)?.code == "unknown-article" ? "card.voteClosed" : "card.voteFailed"))
        }
    }

    static func optimistic(_ previous: Reactions, _ next: Vote?) -> Reactions {
        var value = previous
        if previous.myVote == .up { value.up -= 1 }
        if previous.myVote == .down { value.down -= 1 }
        if next == .up { value.up += 1 }
        if next == .down { value.down += 1 }
        value.myVote = next
        value.up = max(0, value.up)
        value.down = max(0, value.down)
        return value
    }

    /// Save / unsave the story as it is right now (with its live counters).
    /// An onboarding rating moves the story's global counters too (web: like 👍, skip 👎): the
    /// vote is set — never toggled off — and a failure is silent, the rating flow goes on.
    public func rate(_ article: Article, _ vote: Vote) async {
        let state = live(article)
        let previous = state.reactions ?? .zero
        guard previous.myVote != vote, !votesInFlight.contains(article.id) else { return }
        votesInFlight.insert(article.id)
        voteEpoch += 1
        defer {
            votesInFlight.remove(article.id)
            voteEpoch += 1
        }
        state.reactions = Self.optimistic(previous, vote)
        do {
            let result = try await api.voteArticle(article.id, vote.rawValue)
            state.reactions = Reactions(comments: previous.comments, up: result.up, down: result.down, myVote: result.myVote)
        } catch {
            state.reactions = previous
        }
    }

    public func toggleSave(_ article: Article) async {
        let state = live(article)
        var snapshot = article
        snapshot.reactions = state.reactions ?? article.reactions
        state.isSaved.toggle()
        let saved = await library.toggle(snapshot)
        state.isSaved = saved
        if saved { await keepBody(of: article) }
    }

    /// A saved story keeps its text so it reads offline (an iOS addition: the web's Saved holds
    /// the card only): the extraction this session already made, or one made now.
    func keepBody(of article: Article) async {
        if let cached = extractions.body(for: article.id) {
            await library.storeBody(cached, for: article.id)
            return
        }
        guard let body = try? await api.article(article.url),
              !body.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        extractions.store(body, for: article.id)
        await library.storeBody(body, for: article.id)
    }

    /// The text kept with a saved story (the story view reads it before asking the network).
    public func keptBody(of article: Article) async -> ArticleBody? {
        await library.body(for: article.id)
    }

    /// A story extracted while it is saved keeps the fresh text.
    public func keep(_ body: ArticleBody, of article: Article) async {
        guard library.contains(article.id) else { return }
        await library.storeBody(body, for: article.id)
    }

    /// Translate / show the original (web card translate) through the translate ladder.
    public func toggleTranslation(_ article: Article) async {
        let state = live(article)
        if state.translation != nil {
            state.translation = nil
            return
        }
        let target = preferences.value.targetLang
        guard target != article.language else {
            toasts.show(L10n.t("lang.pick"))
            return
        }
        translateBroken = false // a fresh request may succeed where auto-translate failed (web)
        state.isTranslating = true
        defer { state.isTranslating = false }
        guard let result = await translator.translate([article.title, article.description], target, article.language, true),
              result.texts.count == 2 else {
            toasts.show(L10n.t("ios.lang.unavailable"))
            return
        }
        state.translation = .init(language: target, title: result.texts[0], description: result.texts[1])
    }

    // MARK: Auto-translate

    /// A card on screen asks for its translation (web viewport observer): with auto-translate on and
    /// a target other than English, stories in another language join a batch — collected for
    /// 250 ms, then up to 10 stories (20 texts) of one source language per request.
    public func autoTranslate(_ article: Article) {
        let target = preferences.value.targetLang
        guard preferences.value.autoTranslate, target != "en", article.language != target, !translateBroken else { return }
        let state = live(article)
        guard state.translation?.language != target, !state.isTranslating else { return }
        guard !pending.contains(where: { $0.id == article.id }) else { return }
        pending.append(article)
        flushTask?.cancel()
        flushTask = Task { [weak self, clock] in
            try? await clock.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            await self?.flush(target)
        }
    }

    private func flush(_ target: String) async {
        guard !translateBroken, !pending.isEmpty else {
            pending.removeAll()
            return
        }
        let source = pending[0].language
        let batch = Array(pending.filter { $0.language == source }.prefix(10))
        pending.removeAll { article in batch.contains { $0.id == article.id } }
        let texts = batch.flatMap { [$0.title, $0.description] }
        guard let result = await translator.translate(texts, target, source, false), result.texts.count == texts.count else {
            pending.removeAll()
            markTranslateBroken()
            return
        }
        for (index, article) in batch.enumerated() {
            // the reader may have switched languages while the batch was in flight
            guard preferences.value.targetLang == target, preferences.value.autoTranslate else { break }
            live(article).translation = .init(language: target, title: result.texts[2 * index], description: result.texts[2 * index + 1])
        }
        if !pending.isEmpty { await flush(target) } // drain the rest
    }

    /// One toast, then a 75 s pause before the cards on screen ask again (web `markTranslateBroken`).
    private func markTranslateBroken() {
        guard !translateBroken else { return }
        translateBroken = true
        toasts.show(L10n.t("ios.lang.unavailable"))
        brokenRetry?.cancel()
        brokenRetry = Task { [weak self, clock, translationBackoff] in
            try? await clock.sleep(for: translationBackoff)
            guard !Task.isCancelled, let self else { return }
            translateBroken = false
            translationEpoch += 1
        }
    }

    /// The reader picked another language (web `setLanguage`): every translation reverts and the
    /// cards on screen translate again. Picking a language is asking for it: when the device can
    /// download it, the system offers to now.
    public func languageChanged() {
        resetAutoTranslate()
        for state in states.values where state.translation != nil { state.translation = nil }
        translationEpoch += 1
        let target = preferences.value.targetLang
        guard target != "en", preferences.value.autoTranslate else { return }
        let onDevice = onDevice
        Task {
            if await onDevice.availability("en", target) == .downloadable {
                _ = await onDevice.prepare("en", target)
            }
        }
    }

    /// The auto-translate switch (web `setAutoTranslate`): on translates the cards on screen, off
    /// shows every story in its own language again.
    public func autoTranslateChanged() {
        resetAutoTranslate()
        if !preferences.value.autoTranslate {
            for state in states.values where state.translation != nil { state.translation = nil }
        }
        translationEpoch += 1
    }

    private func resetAutoTranslate() {
        translateBroken = false
        brokenRetry?.cancel()
        flushTask?.cancel()
        pending.removeAll()
    }

    /// Keeps saved flags right after the library changes elsewhere (e.g. the Saved tab).
    public func syncSaved() {
        for (id, state) in states {
            let saved = library.contains(id)
            if state.isSaved != saved { state.isSaved = saved }
        }
    }
}
