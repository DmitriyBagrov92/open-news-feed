import Observation
import SwiftUI

/// Transient messages ("Could not register your vote. Try again.") — web `toast.js`: stacked
/// capsules above the tab bar, 3.5 s each, announced to VoiceOver.
@MainActor
@Observable
public final class ToastCenter {
    public struct Toast: Identifiable, Equatable {
        public let id = UUID()
        public let text: String
    }

    public private(set) var toasts: [Toast] = []
    @ObservationIgnored public var duration: Duration = .seconds(3.5)

    public init() {}

    public func show(_ text: String) {
        guard !toasts.contains(where: { $0.text == text }) else { return }
        let toast = Toast(text: text)
        toasts.append(toast)
        AccessibilityNotification.Announcement(text).post()
        Task { [duration] in
            try? await Task.sleep(for: duration)
            toasts.removeAll { $0.id == toast.id }
        }
    }
}

/// The stack of toasts, as glass capsules.
public struct ToastOverlay: View {
    @Environment(ToastCenter.self) private var center

    public init() {}

    public var body: some View {
        VStack(spacing: 8) {
            ForEach(center.toasts) { toast in
                Text(toast.text)
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .glassEffect(.regular, in: .capsule)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .accessibilityIdentifier("toast")
            }
        }
        .padding(.horizontal, 24)
        .animation(.snappy, value: center.toasts)
        .allowsHitTesting(false)
    }
}

/// A slim glass banner ("You're offline — showing stories already loaded.").
public struct GlassBanner: View {
    private let text: String
    private let systemImage: String

    public init(_ text: String, systemImage: String) {
        self.text = text
        self.systemImage = systemImage
    }

    public var body: some View {
        Label(text, systemImage: systemImage)
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .glassEffect(.regular, in: .capsule)
    }
}
