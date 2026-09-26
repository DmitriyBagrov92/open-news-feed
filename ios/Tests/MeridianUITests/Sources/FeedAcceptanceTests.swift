import XCTest

/// P2 acceptance: the live Today feed on the fixture newsroom — the iOS counterparts of the web's
/// feed, infinite-scroll, new-stories, tabs, search, card-actions, gestures, offline and
/// timescale specs (test/e2e/*.spec.js).
final class FeedAcceptanceTests: AcceptanceTestCase {
    // fixture ids (ios/Tests/Fixtures/api): page 1 = hero, row (sports), row, wide …
    private let pageTwoFirst = "1a42b80e1f2b"
    private let pageThreeFirst = "f5a5c8c18f5c"
    private let breaking = "0bd99f751628"

    // MARK: Feed

    func testFeedOpensOnAHeroThenRowsInTimeOrder() {
        let app = launch()
        let heroCard = card(app, hero)
        let rowCard = card(app, row)
        XCTAssertTrue(scroll(app, until: rowCard, maxSwipes: 3))
        if !isPad {
            let heroFrame = heroCard.frame
            XCTAssertGreaterThan(heroFrame.height, 0)
            XCTAssertGreaterThan(rowCard.frame.minY, heroFrame.minY, "the freshest story with a photo leads")
        }
    }

    func testScrollingLoadsLaterPagesWithoutDuplicates() {
        let app = launch()
        XCTAssertTrue(scroll(app, until: card(app, pageTwoFirst)), "page 2 loads near the end of page 1")
        XCTAssertTrue(scroll(app, until: card(app, pageThreeFirst)), "and page 3 after it")
        let heroes = app.descendants(matching: .any).matching(identifier: "card-\(hero)")
        XCTAssertLessThanOrEqual(heroes.count, 1, "no story twice")
    }

    func testNewStoriesWaitBehindThePillAndPrependOnTap() {
        let app = launch([LaunchContract.Env.pollSeconds: "1", LaunchContract.Env.newStories: "1"])
        let pill = app.buttons["new-stories-pill"]
        XCTAssertTrue(pill.waitForExistence(timeout: 20))
        XCTAssertTrue(pill.label.contains("3 NEW STORIES"), pill.label)
        pill.tap()
        XCTAssertTrue(card(app, breaking).waitForExistence(timeout: 5))
        XCTAssertFalse(pill.exists)
    }

    func testCategoryChipsFilterAndTheChoiceSurvivesARelaunch() {
        var app = launch()
        app.buttons["chip-world"].tap()
        XCTAssertTrue(card(app, hero).waitForExistence(timeout: 10), "the world hero stays")
        XCTAssertFalse(scroll(app, until: card(app, row), maxSwipes: 2), "the sports story is gone")
        app.terminate()
        app = XCUIApplication()
        app.launchArguments = [LaunchContract.uiTestMode]
        app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
        app.launchEnvironment[LaunchContract.Env.keepState] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["chip-world"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["chip-world"].isSelected)
    }

    func testSearchFindsStoriesAndSaysWhenNothingMatches() {
        let app = launch()
        openTab(app, "Search")
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        focus(field)
        app.typeText("storm")
        XCTAssertTrue(card(app, hero).waitForExistence(timeout: 10))
        field.buttons.firstMatch.tap() // clear
        focus(field)
        app.typeText("zzqqxx")
        XCTAssertTrue(app.descendants(matching: .any)["empty-search"].waitForExistence(timeout: 10))
    }

    // MARK: Card actions

    func testSavingFromTheCardShowsTheStoryInSaved() {
        let app = launch()
        XCTAssertTrue(scroll(app, until: app.buttons["card-\(row)-save"], maxSwipes: 3))
        app.buttons["card-\(row)-save"].tap()
        openTab(app, "Saved")
        XCTAssertTrue(card(app, row).waitForExistence(timeout: 10))
        app.buttons["card-\(row)-save"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["empty-saved"].waitForExistence(timeout: 10))
    }

    func testSwipingARowRightSavesIt() throws {
        try XCTSkipIf(isPad, "rows in the iPad mosaic answer to the context menu, not swipes")
        let app = launch()
        let rowCard = card(app, row)
        XCTAssertTrue(scroll(app, until: rowCard, maxSwipes: 3))
        rowCard.swipeRight(velocity: .slow)
        openTab(app, "Saved")
        XCTAssertTrue(card(app, row).waitForExistence(timeout: 10))
    }

    func testSwipingARowLeftTranslatesIntoTheChosenLanguage() throws {
        try XCTSkipIf(isPad, "rows in the iPad mosaic answer to the context menu, not swipes")
        let app = launch()
        app.buttons["language-menu"].tap()
        app.buttons["Deutsch"].firstMatch.tap()
        let rowCard = card(app, row)
        XCTAssertTrue(scroll(app, until: rowCard, maxSwipes: 3))
        rowCard.swipeLeft(velocity: .slow)
        XCTAssertTrue(eventually("label CONTAINS '[de]'", card(app, row)))
    }

    func testALongPressOffersTheStoryActions() {
        let app = launch()
        let rowCard = card(app, row)
        XCTAssertTrue(scroll(app, until: rowCard, maxSwipes: 3))
        rowCard.press(forDuration: 1.2)
        for label in ["Save story", "Translate this story", "Open the original article", "Share", "Copy link"] {
            XCTAssertTrue(app.buttons[label].firstMatch.waitForExistence(timeout: 5), label)
        }
    }

    func testVotingTogglesTheCounter() {
        let app = launch()
        let up = app.buttons["card-\(row)-up"]
        XCTAssertTrue(scroll(app, until: up, maxSwipes: 3))
        up.tap()
        XCTAssertTrue(eventually("value == '1'", up, timeout: 5))
        up.tap()
        XCTAssertTrue(eventually("value == '0'", up, timeout: 5))
    }

    // MARK: Chrome

    func testTheOfflineBannerShowsWhenTheNetworkIsGone() {
        let app = launch([LaunchContract.Env.offline: "1"])
        XCTAssertTrue(app.descendants(matching: .any)["offline-banner"].waitForExistence(timeout: 10))
    }

    func testTheTimeChipFollowsTheStoryOnTop() throws {
        try XCTSkipIf(isPad, "iPad shows the rail instead")
        let app = launch()
        let label = app.descendants(matching: .any)["time-chip-label"].firstMatch
        XCTAssertTrue(label.waitForExistence(timeout: 10))
        XCTAssertEqual(label.label, "NOW")
        for _ in 0..<4 { app.swipeUp(velocity: .fast) }
        XCTAssertTrue(eventually("label CONTAINS 'AGO'", label))
    }

    func testTheIPadSidebarListsCategoriesAndTheRailShowsTime() throws {
        try XCTSkipUnless(isPad, "iPad only")
        let app = launch()
        XCTAssertTrue(app.buttons["World"].firstMatch.waitForExistence(timeout: 10) || app.staticTexts["World"].firstMatch.exists)
        XCTAssertTrue(app.descendants(matching: .any)["time-rail"].waitForExistence(timeout: 10))
    }
}
