import XCTest

/// P7 acceptance: Apple Intelligence behind the brief, the story summary and the Ahead forecast —
/// the fake model of the launch contract (`FAKE_MODEL`), or none: then ✦ does not exist (web: no
/// Prompt API, no hint, no gesture, no setting).
final class AIAcceptanceTests: AcceptanceTestCase {
    private let points = [LaunchContract.Env.fakeModel: "points"]

    private func brief(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["brief"]
    }

    private func label(_ root: XCUIElement, containing text: String) -> XCUIElement {
        root.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    func testTheBriefIsWrittenOnDevice() {
        let app = launch(points)
        XCTAssertTrue(label(brief(app), containing: "On-device AI").waitForExistence(timeout: 10), "the provider badge")
        XCTAssertTrue(brief(app).staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "On-device: ")).firstMatch.exists)
    }

    func testWithoutAppleIntelligenceThereIsNoAheadAndTheBriefIsALocalDigest() {
        let app = launch([LaunchContract.Env.fakeModel: "points", LaunchContract.Env.forceNoAI: "1"])
        XCTAssertTrue(label(brief(app), containing: "Local digest").waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["forecast-open"].exists, "no model, no forecast")
        XCTAssertTrue(app.buttons["language-menu"].exists)
    }

    func testTheStorySummaryIsWrittenOnDevice() {
        var environment = points
        environment[LaunchContract.Env.initialRoute] = "story/\(hero)"
        let app = launch(environment) { [hero] app in app.staticTexts["story-\(hero)-title"] }
        app.buttons["story-summarize"].tap()
        let summary = app.descendants(matching: .any)["story-summary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertTrue(eventually("label CONTAINS[c] 'on-device ai'", summary), summary.label)
    }

    func testAheadDraftsFourSpeculativeForecastsAndAChipOpensTheRealStory() {
        let app = launch(points)
        let open = app.buttons["forecast-open"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let sheet = app.descendants(matching: .any)["forecast"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        XCTAssertTrue(label(sheet, containing: "not news, not reporting, not verified").exists, "speculative, and says so")
        let cards = sheet.descendants(matching: .any).matching(identifier: "fcard")
        XCTAssertTrue(cards.element(boundBy: 3).waitForExistence(timeout: 10))
        XCTAssertEqual(cards.count, 4)
        XCTAssertTrue(label(cards.firstMatch, containing: "AI-generated · not news").exists)
        XCTAssertTrue(eventually("label BEGINSWITH 'GENERATED'", app.staticTexts["forecast-status"]))

        // regenerate: thinking, then a fresh set
        app.buttons["forecast-regenerate"].tap()
        XCTAssertTrue(cards.element(boundBy: 3).waitForExistence(timeout: 10))

        // a chip opens the story the forecast builds on, where stories open, and the sheet goes away
        if !isPad { sheet.swipeUp() } // the large detent: every chip on screen
        let chip = sheet.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'fcard-basis-'")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        let id = String(chip.identifier.dropFirst("fcard-basis-".count))
        chip.tap()
        XCTAssertTrue(app.staticTexts["story-\(id)-title"].waitForExistence(timeout: 10), "the real story \(id)")
        XCTAssertTrue(eventually("exists == false", sheet))
    }

    func testClosingAheadReturnsToTheFeed() {
        let app = launch(points)
        app.buttons["forecast-open"].tap()
        let sheet = app.descendants(matching: .any)["forecast"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        app.buttons["forecast-close"].tap()
        XCTAssertTrue(eventually("exists == false", sheet))
        XCTAssertTrue(card(app, hero).exists)
    }
}
