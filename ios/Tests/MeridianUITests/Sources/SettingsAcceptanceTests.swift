import XCTest

/// P10 acceptance: Settings — the iOS counterpart of the web's settings specs: appearance and
/// card size that stay, hiding a source, the blocked commenters, a fresh anonymous identity.
final class SettingsAcceptanceTests: AcceptanceTestCase {
    private func openSettings(_ environment: [String: String] = [:]) -> XCUIApplication {
        var environment = environment
        environment[LaunchContract.Env.initialRoute] = "settings"
        return launch(environment) { app in app.navigationBars["Settings"] }
    }

    func testTheAppearanceIsKeptAcrossLaunches() {
        let app = openSettings()
        let dark = app.segmentedControls["settings-theme"].buttons["Dark"]
        XCTAssertTrue(dark.waitForExistence(timeout: 5))
        dark.tap()
        XCTAssertTrue(dark.isSelected)
        app.terminate()
        let again = openSettings([LaunchContract.Env.keepState: "1"])
        XCTAssertTrue(again.segmentedControls["settings-theme"].buttons["Dark"].isSelected, "the choice stays")
    }

    func testHidingASourceTakesItsStoriesOutOfTheFeed() {
        let app = openSettings()
        app.buttons["settings-sources"].tap()
        let bbc = app.switches["source-bbc-world"]
        XCTAssertTrue(bbc.waitForExistence(timeout: 10))
        // the switch's own control (a tap on the row's label may not reach it)
        bbc.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(eventually("value == '0'", bbc), "switched off")
        app.navigationBars["Sources"].buttons.element(boundBy: 0).tap() // back to Settings
        XCTAssertTrue(app.buttons["settings-close"].waitForExistence(timeout: 5))
        app.buttons["settings-close"].tap()
        // the hero was BBC World's storm story
        XCTAssertTrue(eventually("exists == false", card(app, hero), timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'card-[0-9a-f]{12}'")).firstMatch
            .waitForExistence(timeout: 10), "the feed reloads without it")
    }

    func testABlockedCommenterCanBeUnblocked() {
        let seeded = #"{"blockedAuthors":[{"key":"4f84573aeaa507b3","name":"Lunar Tundra"}]}"#
        let app = openSettings([LaunchContract.Env.seedPrefs: seeded])
        app.buttons["settings-blocked"].tap()
        let unblock = app.buttons["unblock-4f84573aeaa507b3"]
        XCTAssertTrue(unblock.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Lunar Tundra"].exists)
        unblock.tap()
        XCTAssertTrue(app.staticTexts["blocked-none"].waitForExistence(timeout: 5))
    }

    func testANewAnonymousIdentityIsConfirmedFirst() {
        let app = openSettings()
        let reset = app.buttons["settings-reset-identity"]
        for _ in 0..<4 where !reset.isHittable { app.swipeUp() }
        reset.tap()
        let confirm = app.buttons["Reset identity"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "asks first")
        confirm.tap()
        // the footer under the button says so (the sheet sits above the toasts); on a phone it
        // may sit just below the edge — list rows off screen are not in the accessibility tree
        let done = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'You have a new anonymous identity'")).firstMatch
        for _ in 0..<3 where !done.waitForExistence(timeout: 1.5) { app.swipeUp() }
        XCTAssertTrue(done.exists, "confirmed in place")
    }
}
