import XCTest

/// P3 acceptance: the story view — the iOS counterparts of the web's preview, article-text,
/// summarize, translate and story-navigation specs (test/e2e/*.spec.js).
final class StoryAcceptanceTests: AcceptanceTestCase {
    private func title(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.staticTexts["story-\(id)-title"]
    }

    /// Any element showing exactly this text (selectable story text is not always a static text).
    private func text(_ app: XCUIApplication, _ label: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Launches straight into a Today story (`INITIAL_ROUTE story/<id>`).
    @discardableResult
    private func openStory(_ id: String, _ environment: [String: String] = [:]) -> XCUIApplication {
        var environment = environment
        environment[LaunchContract.Env.initialRoute] = "story/\(id)"
        return launch(environment) { [unowned self] app in title(app, id) }
    }

    /// Back on iPhone, the close button of the pane on iPad.
    private func leaveStory(_ app: XCUIApplication) {
        if isPad {
            app.buttons["story-close"].tap()
        } else {
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
    }

    func testTappingACardOpensItsStoryAndLeavingReturnsToTheFeed() {
        let app = launch()
        // the hero's headline sits by the tab bar on a phone: tap its photo, like a reader would
        card(app, hero).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: -120)).tap()
        XCTAssertTrue(title(app, hero).waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, "What to expect overnight").waitForExistence(timeout: 10), "the extracted text, headings included")
        leaveStory(app)
        XCTAssertTrue(eventually("exists == false", title(app, hero)))
        XCTAssertTrue(card(app, hero).isHittable)
    }

    func testAStoryWithoutExtractableTextShowsTheDescriptionAndTheNote() {
        let app = openStory(row)
        XCTAssertTrue(app.staticTexts["story-note"].waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, "Full text unavailable — read at source.").exists)
    }

    /// UIKit restores the pane's column with the window, SwiftUI starts with the pane closed: a
    /// launch after a pane left open could keep its width as an empty strip on the right (the
    /// toolbar and the feed ended short of it) until OrphanedInspector repaired it. It is a race —
    /// without the repair it struck in one round of nine here (five of twelve on the App Store
    /// newsroom), so this guard is loose: a red run is the bug; a green one proves little alone.
    func testAPaneLeftOpenLeavesNoEmptyStripAtTheNextLaunch() throws {
        try XCTSkipUnless(isPad, "iPad only")
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        for round in 1...3 {
            openStory(hero)
            let app = launch()
            let gear = app.buttons["settings-open"]
            XCTAssertTrue(gear.waitForExistence(timeout: 10))
            Thread.sleep(forTimeInterval: 1.5) // the repair runs a quarter of a second after the launch
            XCTAssertGreaterThan(gear.frame.maxX, app.windows.firstMatch.frame.width - 60,
                                 "round \(round): the toolbar reaches the window's edge")
        }
    }

    func testSwipingWalksTheFeed() throws {
        try XCTSkipIf(isPad, "the pane walks with its arrows")
        let app = openStory(hero)
        app.swipeLeft()
        XCTAssertTrue(eventually("isHittable == true", title(app, row)), "the next story in the feed")
        app.swipeRight()
        XCTAssertTrue(eventually("isHittable == true", title(app, hero)))
    }

    func testThePaneWalksTheFeedWithItsArrowsAndKeys() throws {
        try XCTSkipUnless(isPad, "iPad only")
        let app = openStory(hero)
        XCTAssertFalse(app.buttons["story-prev"].isEnabled, "the first story has no previous one")
        app.buttons["story-next"].tap()
        XCTAssertTrue(eventually("isHittable == true", title(app, row)))
        XCTAssertTrue(app.buttons["story-prev"].isEnabled)
        app.typeKey(.leftArrow, modifierFlags: [])
        XCTAssertTrue(eventually("isHittable == true", title(app, hero)), "← goes back, like the web")
        app.typeKey(.rightArrow, modifierFlags: [])
        XCTAssertTrue(eventually("isHittable == true", title(app, row)), "→ goes forward")
    }

    func testSummarizeShowsKeyPointsFromTheLocalDigest() {
        let app = openStory(hero)
        app.buttons["story-summarize"].tap()
        let summary = app.descendants(matching: .any)["story-summary"]
        XCTAssertTrue(summary.waitForExistence(timeout: 10))
        XCTAssertTrue(summary.label.contains("KEY POINTS"), summary.label)
        XCTAssertTrue(summary.label.contains("LOCAL DIGEST"), summary.label)
    }

    func testTranslateShowsTheChosenLanguageAndTheChipTogglesBack() {
        let app = openStory(hero, [LaunchContract.Env.seedPrefs: #"{"targetLang":"de"}"#])
        XCTAssertTrue(text(app, "What to expect overnight").waitForExistence(timeout: 10))
        app.buttons["story-translate"].tap()
        XCTAssertTrue(eventually("label BEGINSWITH '[de] '", title(app, hero)))
        XCTAssertTrue(text(app, "[de] What to expect overnight").exists, "headings translate in place")
        app.buttons["story-chip"].tap()
        XCTAssertTrue(eventually("label BEGINSWITH 'Coastal towns'", title(app, hero)))
    }

    func testAutoTranslateOpensTheStoryTranslated() {
        let app = openStory(hero, [LaunchContract.Env.seedPrefs: #"{"targetLang":"de","autoTranslate":true}"#])
        XCTAssertTrue(eventually("label BEGINSWITH '[de] '", title(app, hero), timeout: 15))
    }

    func testVotingAndSavingFromTheStory() {
        let app = openStory(hero)
        let up = app.buttons["story-up"]
        up.tap()
        XCTAssertTrue(eventually("value == '1'", up))
        app.buttons["story-save"].tap()
        XCTAssertTrue(eventually("label == 'Remove from saved'", app.buttons["story-save"]))
        leaveStory(app)
        openTab(app, "Saved")
        XCTAssertTrue(card(app, hero).waitForExistence(timeout: 10), "the story is in Saved")
        XCTAssertTrue(eventually("value == '1'", app.buttons["card-\(hero)-up"]), "with the vote it had")
    }
}
