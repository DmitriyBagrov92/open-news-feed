import ArticleKit
import CoreModels
import Dependencies
import Foundation
import Intelligence
import Observation

/// Ahead · the AI forecast (web forecast.js): four speculative events for the next seven days,
/// drafted on this device from the stories in view. Opened from ✦; a forecast is cached per view
/// for 30 minutes (the last 8 views); closing the sheet drops an unfinished run.
@MainActor
@Observable
public final class ForecastStore {
    public struct Entry: Equatable {
        public let forecasts: [Forecast]
        /// The language the headlines are in.
        public let language: String
        /// "on-device" or "mock".
        public let provider: String
        public let generatedAt: Int64
        /// The pool's stories by id: the basis chips open the real ones.
        public let articles: [String: Article]
    }

    public enum Phase: Equatable {
        case idle
        /// Skeletons while the model drafts.
        case thinking
        case shown(Entry)
        /// A message instead of forecasts (web `renderNote`), with a Retry button or without.
        case note(String, retry: Bool)
    }

    public private(set) var phase: Phase = .idle
    public private(set) var availability: LanguageModelClient.Availability

    /// ✦ exists only where the model does (web: no model — no hint, no gesture, no setting).
    public var isSupported: Bool { availability != .unavailable }

    public static let ttl: Int64 = 30 * 60_000
    public static let capacity = 8
    /// The first page of the view (web `fetchPool`: pageSize 30).
    public static let poolSize = 30

    @ObservationIgnored private var cache: [(key: String, entry: Entry)] = []
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var sequence = 0
    @ObservationIgnored @Dependency(\.forecaster) private var forecaster
    @ObservationIgnored @Dependency(\.languageModel) private var model
    @ObservationIgnored @Dependency(\.date) private var date

    public init() {
        @Dependency(\.languageModel) var model
        availability = model.availability()
    }

    /// Apple Intelligence may have been switched on (or its model finished downloading) meanwhile.
    public func refreshAvailability() {
        availability = model.availability()
    }

    /// ✦: this view's fresh forecast shows at once; otherwise a run starts.
    public func open(_ feed: FeedStore) {
        refreshAvailability()
        if let cached = valid(feed.forecastKey) {
            phase = .shown(cached)
        } else {
            run(feed)
        }
    }

    /// Regenerate / Retry: a new run whatever is cached.
    public func run(_ feed: FeedStore) {
        sequence += 1
        let current = sequence
        task?.cancel()
        refreshAvailability()
        guard availability == .available else {
            // the model is still downloading (Settings › Apple Intelligence): nothing to run yet
            phase = .note(availability == .notReady ? "ios.ahead.notReady" : ForecastError.error.rawValue, retry: true)
            return
        }
        let key = feed.forecastKey
        let target = feed.targetLanguage
        let articles = Array(feed.newestFirst.prefix(Self.poolSize))
        let pool = ForecastKit.pool(articles)
        guard pool.count >= ForecastKit.minArticles else {
            phase = .note(ForecastError.tooFew.rawValue, retry: false)
            return
        }
        let byID = Dictionary(articles.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        phase = .thinking
        task = Task { [weak self, forecaster] in
            do {
                let result = try await forecaster.run(pool, target)
                guard let self, current == self.sequence else { return }
                let entry = Entry(forecasts: result.forecasts, language: result.language, provider: result.provider,
                                  generatedAt: self.now, articles: byID)
                self.remember(key, entry)
                self.phase = .shown(entry)
            } catch {
                guard let self, current == self.sequence, !Task.isCancelled else { return }
                // an echo or a waffle after the one retry keeps its own message; anything else is an error
                let reason = (error as? ForecastError).map(\.rawValue) ?? ForecastError.error.rawValue
                self.phase = .note(reason, retry: true)
            }
        }
    }

    /// The sheet closed: an unfinished run is dropped (web close → invalidate).
    public func close() {
        sequence += 1
        task?.cancel()
        task = nil
        phase = .idle
    }

    /// A new language invalidates every cached forecast (web `meridian:langchange`).
    public func languageChanged() {
        cache.removeAll()
        close()
    }

    private var now: Int64 { Int64(date.now.timeIntervalSince1970 * 1000) }

    private func valid(_ key: String) -> Entry? {
        guard let entry = cache.first(where: { $0.key == key })?.entry, now - entry.generatedAt < Self.ttl else { return nil }
        return entry
    }

    /// Insertion-ordered like the web's Map: a re-run moves to the end, the oldest falls out.
    private func remember(_ key: String, _ entry: Entry) {
        cache.removeAll { $0.key == key }
        cache.append((key, entry))
        if cache.count > Self.capacity { cache.removeFirst(cache.count - Self.capacity) }
    }
}
