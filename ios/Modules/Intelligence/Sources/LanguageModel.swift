import CoreModels
import Dependencies
import Foundation

/// The on-device language model (Apple Intelligence through FoundationModels, implemented in
/// AppleAI). Summaries and the brief ask for free text; the forecast for structured drafts. Every
/// failure — no model, a refusal, a guardrail, a timeout — is thrown, and the ladders move on.
public struct LanguageModelClient: Sendable {
    public enum Availability: Sendable, Equatable {
        case available
        /// Apple Intelligence is on but the model is still downloading.
        case notReady
        /// Not eligible, switched off, or no model at all: the AI features do not exist.
        case unavailable
    }

    /// "on-device", or "mock" for the stand-in the UI tests use (web `forecastMockMode`): the
    /// forecast then shows the web's mock drafts, loosely sanitized.
    public var provider: String
    public var availability: @Sendable () -> Availability
    /// The languages the model writes (ISO codes: "en", "de", "ja"…).
    public var languages: @Sendable () -> Set<String>
    /// Free text for news summaries (content transformations of reporting that may describe
    /// violence or crime are allowed).
    public var respond: @Sendable (_ instructions: String, _ prompt: String) async throws -> String
    /// Forecast candidates: the web's prompts and worked example, structured output.
    public var forecast: @Sendable (_ instructions: String, _ exampleUser: String, _ exampleAssistant: String, _ prompt: String) async throws -> [ForecastDraft]

    public init(
        provider: String = "on-device",
        availability: @escaping @Sendable () -> Availability,
        languages: @escaping @Sendable () -> Set<String>,
        respond: @escaping @Sendable (_ instructions: String, _ prompt: String) async throws -> String,
        forecast: @escaping @Sendable (_ instructions: String, _ exampleUser: String, _ exampleAssistant: String, _ prompt: String) async throws -> [ForecastDraft]
    ) {
        self.provider = provider
        self.availability = availability
        self.languages = languages
        self.respond = respond
        self.forecast = forecast
    }

    public static let unavailable = LanguageModelClient(
        availability: { .unavailable },
        languages: { [] },
        respond: { _, _ in throw LanguageModelError.unavailable },
        forecast: { _, _, _, _ in throw LanguageModelError.unavailable }
    )

    /// The language to ask for: the reader's when the model writes it, English otherwise (the
    /// caller translates).
    public func outputLanguage(for target: String) -> String {
        languages().contains(target) ? target : "en"
    }
}

public enum LanguageModelError: Error, Sendable, Equatable {
    case unavailable
    case refused
    case timedOut
    case empty
}

extension LanguageModelClient: DependencyKey {
    /// The app installs Apple's model at launch (AppleAI); nothing until then.
    public static var liveValue: LanguageModelClient { .unavailable }
    public static var testValue: LanguageModelClient { .unavailable }
}

public extension DependencyValues {
    var languageModel: LanguageModelClient {
        get { self[LanguageModelClient.self] }
        set { self[LanguageModelClient.self] = newValue }
    }
}

/// Model output that is a refusal in prose ("I'm sorry, but I can't…") rather than an answer.
public enum Refusal {
    private static let openings = [
        "i'm sorry", "i am sorry", "i apologize", "sorry, i", "i can't", "i cannot", "i can’t", "i’m sorry",
        "as an ai", "i'm unable", "i am unable", "i’m unable", "unfortunately, i",
    ]

    public static func isRefusal(_ text: String) -> Bool {
        let head = TextKit.jsTrim(text).lowercased().prefix(80)
        return openings.contains { head.hasPrefix($0) }
    }
}

/// Races an operation against a deadline (web `withTimeout`, a `Promise.race`): a hung generation
/// must never freeze a button. At the deadline the caller moves on with `timedOut` even if the
/// operation does not stop at once (a task group would wait for it — for a generation queued
/// behind another one, or one that ignores cancellation); the operation is cancelled and ends on
/// its own.
public func withDeadline<T: Sendable>(_ seconds: Double, _ operation: @escaping @Sendable () async throws -> T) async throws -> T {
    let race = Race<T>()
    return try await withTaskCancellationHandler {
        try await withCheckedThrowingContinuation { continuation in
            race.start(continuation, seconds: seconds, operation)
        }
    } onCancel: {
        race.finish(.failure(CancellationError()))
    }
}

/// The first result wins; the losers are cancelled.
private final class Race<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?
    private var tasks: [Task<Void, Never>] = []
    private var finished = false

    func start(_ continuation: CheckedContinuation<T, Error>, seconds: Double, _ operation: @escaping @Sendable () async throws -> T) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            continuation.resume(throwing: CancellationError()) // cancelled before it began
            return
        }
        self.continuation = continuation
        lock.unlock()
        let work = Task {
            do { self.finish(.success(try await operation())) } catch { self.finish(.failure(error)) }
        }
        let timer = Task {
            try? await Task.sleep(for: .seconds(seconds))
            self.finish(.failure(LanguageModelError.timedOut))
        }
        lock.lock()
        tasks = [work, timer]
        let done = finished
        lock.unlock()
        if done {
            work.cancel()
            timer.cancel()
        }
    }

    func finish(_ result: Result<T, Error>) {
        lock.lock()
        guard !finished else {
            lock.unlock()
            return
        }
        finished = true
        let continuation = continuation
        self.continuation = nil
        let tasks = tasks
        lock.unlock()
        tasks.forEach { $0.cancel() }
        continuation?.resume(with: result)
    }
}
