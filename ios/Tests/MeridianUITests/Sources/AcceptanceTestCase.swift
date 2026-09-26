import XCTest

/// Shared launch and query helpers of the acceptance suites (the fixture newsroom, the launch
/// contract, the gotchas listed in ios/CLAUDE.md).
@MainActor
class AcceptanceTestCase: XCTestCase {
    /// Fixture ids (ios/Tests/Fixtures/api): the hero is story-a (rich blocks), the first row's
    /// extraction fails (422).
    let hero = "825452304de0"
    let row = "cd5d68db7c99"

    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    override func setUp() {
        continueAfterFailure = false
    }

    /// Launches the app on the fixture newsroom and waits for `element` (default: the hero card).
    @discardableResult
    func launch(_ environment: [String: String] = [:],
                waitFor element: ((XCUIApplication) -> XCUIElement)? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [LaunchContract.uiTestMode]
        app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
        for (key, value) in environment { app.launchEnvironment[key] = value }
        app.launch()
        let first = element?(app) ?? card(app, hero)
        XCTAssertTrue(first.waitForExistence(timeout: 20), "the app opens on the fixture newsroom")
        return app
    }

    func card(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)["card-\(id)"].firstMatch
    }

    func scroll(_ app: XCUIApplication, until element: XCUIElement, maxSwipes: Int = 40) -> Bool {
        for _ in 0..<maxSwipes {
            if element.exists && element.isHittable { return true }
            app.swipeUp(velocity: .fast)
        }
        return element.exists
    }

    /// Waits for a predicate on an element (XCTWaiter keeps the test case out of the closure).
    func eventually(_ format: String, _ element: XCUIElement, timeout: TimeInterval = 10) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: timeout) == .completed
    }

    /// Makes sure a text field has keyboard focus (tap its text area, not a clear/mic button).
    func focus(_ field: XCUIElement) {
        for _ in 0..<3 {
            if (field.value(forKey: "hasKeyboardFocus") as? Bool) == true { return }
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
            Thread.sleep(forTimeInterval: 0.6)
        }
    }

    /// Taps a tab — on iPhone the bar may be minimised after scrolling, so scroll back up first
    /// (the bar expands again); on iPad the tabs are sidebar rows.
    func openTab(_ app: XCUIApplication, _ label: String) {
        for _ in 0..<6 where !app.tabBars.buttons[label].exists && !app.buttons[label].firstMatch.exists {
            app.swipeDown(velocity: .fast)
        }
        let tab = app.tabBars.buttons[label]
        if tab.exists {
            tab.tap()
        } else {
            XCTAssertTrue(app.buttons[label].firstMatch.waitForExistence(timeout: 5), "tab \(label)")
            app.buttons[label].firstMatch.tap()
        }
    }
}
