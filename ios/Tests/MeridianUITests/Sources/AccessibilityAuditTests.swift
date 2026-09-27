import XCTest

/// P10: Xcode's accessibility audit over every main screen, for what it judges reliably: labels,
/// traits and hit regions. Contrast, Dynamic Type, clipped text and
/// text detection stay out: the sampler reads Liquid Glass and photographs as the colour behind the
/// text (it flags black text on white glass), measures tracked small caps as clipped, and reads
/// decorative tile initials and the feed dimmed behind an iPad form sheet as unreachable text — and
/// those screenshot-based checks are what made the audit time out on two simulators at once. Their
/// real findings were fixed (stance colours, the tile fade, lane labels, the world clocks as one
/// element, large-text layouts); large text is checked by eye (ios/CLAUDE.md "Accessibility").
final class AccessibilityAuditTests: AcceptanceTestCase {
    private static let enforced: XCUIAccessibilityAuditType = [.hitRegion, .sufficientElementDescription, .trait]

    private func audit(_ app: XCUIApplication, _ screen: String) throws {
        do {
            try runAudit(app, screen)
        } catch let error as NSError where Self.timedOut(error) {
            // two simulators under test at once, not a finding: once more
            try runAudit(app, screen)
        }
    }

    /// "Audit failed to complete in time" (the audit's own domain, -56) or "Timed out while running
    /// accessibility audit" (XCTFuture, 1000).
    private static func timedOut(_ error: NSError) -> Bool {
        (error.domain == "com.apple.xcode.xctest.accessibilityAudit" && error.code == -56)
            || (error.domain == "com.apple.dt.XCTest.XCTFuture" && error.code == 1000)
    }

    private func runAudit(_ app: XCUIApplication, _ screen: String) throws {
        try app.performAccessibilityAudit(for: Self.enforced) { issue in
            print("AUDIT-FAIL \(screen): [\(issue.auditType.rawValue)] \(issue.compactDescription) — \(issue.element?.debugDescription.prefix(240) ?? "no element")")
            return false // every finding fails the test
        }
    }

    func testToday() throws {
        let app = launch()
        try audit(app, "today")
    }

    func testStory() throws {
        let app = launch([LaunchContract.Env.initialRoute: "story/\(hero)"]) { [hero] app in app.staticTexts["story-\(hero)-title"] }
        try audit(app, "story")
    }

    func testSettings() throws {
        let app = launch([LaunchContract.Env.initialRoute: "settings"]) { app in app.navigationBars["Settings"] }
        try audit(app, "settings")
    }

    func testYourFeed() throws {
        let app = launch([LaunchContract.Env.initialRoute: "yourFeed"]) { app in app.staticTexts["onboard-progress"] }
        try audit(app, "your feed")
    }

    func testBattle() throws {
        let app = launch([LaunchContract.Env.initialRoute: "battle"]) { app in app.descendants(matching: .any)["battle-legend"] }
        Thread.sleep(forTimeInterval: 2)
        try audit(app, "battle")
    }
}
