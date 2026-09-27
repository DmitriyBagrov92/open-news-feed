import UIKit

/// UIKit keeps a window's column state with its scene (the session's internal user info): after
/// the system ends the app with a story open in the iPad pane, the next launch restores that
/// state. SwiftUI starts with every pane closed and the inspector column hidden — yet about every
/// other such launch the feed's column kept the inspector's width (280 pt) as a trailing safe-area
/// inset: the toolbar, the time rail and the mosaic ended short of an empty strip until the next
/// rotation or story (found in the App Store captures).
@MainActor
enum OrphanedInspector {
    /// Repairs every split view whose columns still make room for a hidden inspector. Shown, then
    /// hidden a moment later (UIKit ignores a hide during the show), the inspector takes the inset
    /// with it; the strip was empty anyway, so nothing visible happens. `stillClosed` is asked again
    /// before the hide — a story opened meanwhile keeps its pane. Returns how many it repaired.
    @discardableResult
    static func repair(stillClosed: () -> Bool) async -> Int {
        var stale: [UISplitViewController] = []
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        var pending = windows.compactMap(\.rootViewController)
        while let controller = pending.popLast() {
            if let split = controller as? UISplitViewController, !split.isShowing(.inspector),
               split.children.contains(where: { ($0.viewIfLoaded?.safeAreaInsets.right ?? 0) > split.view.safeAreaInsets.right + 0.5 }) {
                stale.append(split)
            }
            pending.append(contentsOf: controller.children)
            if let presented = controller.presentedViewController { pending.append(presented) }
        }
        guard !stale.isEmpty else { return 0 }
        UIView.performWithoutAnimation { stale.forEach { $0.show(.inspector) } }
        try? await Task.sleep(for: .milliseconds(100))
        guard stillClosed() else { return 0 }
        UIView.performWithoutAnimation { stale.forEach { $0.hide(.inspector) } }
        return stale.count
    }
}
