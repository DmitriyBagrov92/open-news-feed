import XCTest

/// P8 acceptance: Your Feed — the iOS counterpart of the web's onboarding and recommendations
/// specs: a round of five (buttons and swipes), likes in Saved, the ranked feed, "Tune more".
final class YourFeedAcceptanceTests: AcceptanceTestCase {
    /// A profile that has rated its five (no weights: the feed is the freshest, and says so).
    private let tuned = #"{"taste":{"count":5,"sources":[],"cats":[],"tokens":[],"rated":[]}}"#

    private func openYourFeed(_ environment: [String: String] = [:],
                              waitFor element: @escaping (XCUIApplication) -> XCUIElement) -> XCUIApplication {
        var environment = environment
        environment[LaunchContract.Env.initialRoute] = "yourFeed"
        return launch(environment, waitFor: element)
    }

    private func progress(_ app: XCUIApplication) -> XCUIElement {
        app.staticTexts["onboard-progress"]
    }

    /// Story cards on screen (the headline blocks, `card-<articleID>`).
    private func cards(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'card-[0-9a-f]{12}'"))
    }

    func testARoundOfFiveTeachesYourTasteThenRanksYourFeed() {
        let app = openYourFeed { [unowned self] app in progress(app) }
        XCTAssertEqual(progress(app).label, "0 / 5")
        let card = app.descendants(matching: .any)["onboard-card"]
        XCTAssertTrue(card.waitForExistence(timeout: 10))

        app.buttons["onboard-like"].tap()
        XCTAssertTrue(eventually("label == '1 / 5'", progress(app)))
        app.buttons["onboard-skip"].tap()
        XCTAssertTrue(eventually("label == '2 / 5'", progress(app)))
        card.swipeRight(velocity: .fast)
        XCTAssertTrue(eventually("label == '3 / 5'", progress(app)), "a swipe right likes")
        card.swipeLeft(velocity: .fast)
        XCTAssertTrue(eventually("label == '4 / 5'", progress(app)), "a swipe left skips")
        app.buttons["onboard-like"].tap()

        XCTAssertTrue(toast(app, "Your feed is ready").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tune-more"].waitForExistence(timeout: 10), "the ranked feed")
        XCTAssertGreaterThan(cards(app).count, 0)

        openTab(app, "Saved")
        XCTAssertTrue(cards(app).element(boundBy: 2).waitForExistence(timeout: 10))
        XCTAssertEqual(cards(app).count, 3, "the three likes are saved")
    }

    func testTuneMoreStartsAnotherRound() {
        let app = openYourFeed([LaunchContract.Env.seedPrefs: tuned]) { app in app.buttons["tune-more"] }
        XCTAssertGreaterThan(cards(app).count, 0, "five ratings: the ranked feed comes first")
        app.buttons["tune-more"].tap()
        XCTAssertTrue(progress(app).waitForExistence(timeout: 10))
        XCTAssertEqual(progress(app).label, "0 / 5")
        XCTAssertTrue(app.descendants(matching: .any)["onboard-card"].waitForExistence(timeout: 10))
    }
}
