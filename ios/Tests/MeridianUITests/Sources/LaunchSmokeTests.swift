import XCTest

/// The app launches on the fixture newsroom: Today, the brief and the first cards are there.
final class LaunchSmokeTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    func testLaunchesOnTheFixtureNewsroom() {
        let app = XCUIApplication()
        app.launchArguments = [LaunchContract.uiTestMode]
        app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
        app.launch()
        XCTAssertTrue(app.otherElements["brief"].waitForExistence(timeout: 20) || app.staticTexts["BRIEF"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["chip-all"].exists || app.buttons["All"].exists)
        XCTAssertTrue(app.buttons["card-825452304de0"].waitForExistence(timeout: 10), "the lead fixture story is the hero")
    }
}
