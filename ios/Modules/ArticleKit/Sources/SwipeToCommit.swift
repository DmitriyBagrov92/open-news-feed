import DesignSystem
import SwiftUI
import UIKit

/// The web's row swipe (cards.js:219-280): the row slides under the finger (±112 pt) over an
/// action block; releasing past 72 pt commits — right saves, left translates. Only horizontal
/// pans begin, so vertical scrolling is never blocked.
public struct SwipeAction {
    public let title: String
    public let systemImage: String
    public let tint: Color
    public let perform: @MainActor () -> Void

    public init(title: String, systemImage: String, tint: Color, perform: @escaping @MainActor () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.tint = tint
        self.perform = perform
    }
}

public enum SwipeRules {
    public static let commit: CGFloat = 72
    public static let limit: CGFloat = 112

    /// The row offset for a finger translation: 1:1 up to the limit.
    public static func offset(for translation: CGFloat) -> CGFloat {
        min(limit, max(-limit, translation))
    }

    /// Which side commits for a release at `translation` (nil = spring back).
    public static func committedEdge(for translation: CGFloat) -> HorizontalEdge? {
        if translation >= commit { return .leading }
        if translation <= -commit { return .trailing }
        return nil
    }
}

struct SwipeToCommit: ViewModifier {
    let leading: SwipeAction?
    let trailing: SwipeAction?
    @State private var offset: CGFloat = 0
    @State private var armed: HorizontalEdge?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .offset(x: offset)
            .background(alignment: .leading) {
                if offset > 0, let leading { block(leading, width: offset, edge: .leading) }
            }
            .background(alignment: .trailing) {
                if offset < 0, let trailing { block(trailing, width: -offset, edge: .trailing) }
            }
            .gesture(HorizontalPan(
                changed: { translation in
                    let clamped = SwipeRules.offset(for: translation)
                    offset = (clamped > 0 && leading == nil) || (clamped < 0 && trailing == nil) ? 0 : clamped
                    armed = SwipeRules.committedEdge(for: offset)
                },
                ended: { translation in
                    let edge = SwipeRules.committedEdge(for: SwipeRules.offset(for: translation))
                    if edge == .leading { leading?.perform() }
                    if edge == .trailing { trailing?.perform() }
                    withAnimation(reduceMotion ? .none : .spring(response: 0.42, dampingFraction: 0.8)) { offset = 0 }
                    armed = nil
                }
            ))
            .sensoryFeedback(.impact(weight: .light), trigger: armed) { _, new in new != nil }
    }

    private func block(_ action: SwipeAction, width: CGFloat, edge: HorizontalEdge) -> some View {
        let isArmed = armed == edge
        return ZStack(alignment: edge == .leading ? .leading : .trailing) {
            RoundedRectangle(cornerRadius: 16, style: .continuous).fill(action.tint.opacity(isArmed ? 1 : 0.75))
            Label(action.title, systemImage: action.systemImage)
                .labelStyle(.iconOnly)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .scaleEffect(isArmed ? 1.15 : 1)
                .padding(.horizontal, 22)
        }
        .frame(width: width)
        .padding(.vertical, 6)
        .animation(.snappy(duration: 0.2), value: isArmed)
    }
}

public extension View {
    /// Row swipe actions (rows only — posters answer to long press, like the web).
    func swipeToCommit(leading: SwipeAction?, trailing: SwipeAction?) -> some View {
        modifier(SwipeToCommit(leading: leading, trailing: trailing))
    }
}

/// A pan that only begins when the finger moves more sideways than up/down.
struct HorizontalPan: UIGestureRecognizerRepresentable {
    let changed: @MainActor (CGFloat) -> Void
    let ended: @MainActor (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        pan.maximumNumberOfTouches = 1
        return pan
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        let translation = recognizer.translation(in: recognizer.view).x
        switch recognizer.state {
        case .changed: changed(translation)
        case .ended, .cancelled, .failed: ended(recognizer.state == .ended ? translation : 0)
        default: break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y) * 1.3
        }
    }
}
