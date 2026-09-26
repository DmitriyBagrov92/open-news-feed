import Foundation
import Intelligence
import Observation
import SwiftUI
import Translation

/// Hands a language download from the translate ladder to `TranslationHost`: only a view can run
/// `.translationTask`, the one way to show the system's download sheet.
@MainActor
@Observable
public final class TranslationBroker {
    /// Non-nil while a download is being prepared (the host's `.translationTask` runs on it).
    public private(set) var configuration: TranslationSession.Configuration?
    @ObservationIgnored private var waiting: CheckedContinuation<Bool, Never>?

    public init() {}

    /// → true once the pair is installed; false when declined, failed or another sheet is up.
    func request(_ source: Locale.Language, _ target: Locale.Language) async -> Bool {
        guard waiting == nil else { return false }
        return await withCheckedContinuation { continuation in
            waiting = continuation
            configuration = TranslationSession.Configuration(source: source, target: target)
        }
    }

    func finish(_ installed: Bool) {
        configuration = nil
        waiting?.resume(returning: installed)
        waiting = nil
    }
}

public extension OnDeviceTranslation {
    /// Apple's Translation framework: installed pairs translate offline on the device; a download
    /// goes through the broker's host (the system sheet the reader confirms).
    static func apple(broker: TranslationBroker) -> OnDeviceTranslation {
        OnDeviceTranslation(
            availability: { source, target in
                await AppleTranslation.availability(source, target)
            },
            translate: { texts, source, target in
                try await AppleTranslation.translate(texts, source, target)
            },
            prepare: { source, target in
                await broker.request(AppleTranslation.language(source), AppleTranslation.language(target))
            }
        )
    }
}

enum AppleTranslation {
    /// The app's language codes as the framework names them (Chinese is Simplified).
    static func language(_ code: String) -> Locale.Language {
        Locale.Language(identifier: code == "zh" ? "zh-Hans" : code)
    }

    /// `LanguageAvailability` is not Sendable: created and used inside this one function.
    static func availability(_ source: String, _ target: String) async -> OnDeviceTranslation.Availability {
        switch await LanguageAvailability().status(from: language(source), to: language(target)) {
        case .installed: .installed
        case .supported: .downloadable
        case .unsupported: .unsupported
        @unknown default: .unsupported
        }
    }

    /// One batch through a session for an installed pair (throws `notInstalled` otherwise). The
    /// session is not Sendable either, so it lives and dies in here. Blank texts pass through.
    static func translate(_ texts: [String], _ source: String, _ target: String) async throws -> [String] {
        let session = TranslationSession(installedSource: language(source), target: language(target))
        let requests = texts.enumerated()
            .filter { !$0.element.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
        var out = texts
        guard !requests.isEmpty else { return out }
        for response in try await session.translations(from: requests) {
            if let index = response.clientIdentifier.flatMap(Int.init), out.indices.contains(index) {
                out[index] = response.targetText
            }
        }
        return out
    }
}

/// Mount once at the root: shows the system's language download sheet when the ladder asks for a
/// pair the reader wants (a card or story they translate, the language they pick).
public struct TranslationHost: ViewModifier {
    let broker: TranslationBroker

    public init(broker: TranslationBroker) {
        self.broker = broker
    }

    public func body(content: Content) -> some View {
        content.translationTask(broker.configuration, action: Preparer(broker: broker).prepare)
    }
}

/// The download itself, nonisolated: the session is not Sendable, so it must not cross into the
/// main actor — only the outcome does.
private struct Preparer: Sendable {
    let broker: TranslationBroker

    func prepare(_ session: TranslationSession) async {
        do {
            try await session.prepareTranslation()
            await broker.finish(true)
        } catch {
            await broker.finish(false)
        }
    }
}
