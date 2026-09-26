import XCTest

/// P5 acceptance: a story's comments — the iOS counterparts of the web's comments and
/// comments-moderation specs. The fixture story-a carries three comments; the reader is the
/// fixtures' "amber" author, so one of them is their own.
final class CommentsAcceptanceTests: AcceptanceTestCase {
    private let theirs = "cc00000000000002"   // Lunar Tundra — liked by the reader
    private let other = "cc00000000000003"    // Mellow Kestrel
    private let mine = "cc00000000000001"     // Solar Jetty — the reader

    /// Opens story-a and scrolls to its conversation through the dock's 💬.
    private func openConversation() -> (XCUIApplication, XCUIElement) {
        let app = launch([LaunchContract.Env.initialRoute: "story/\(hero)"]) { [unowned self] app in
            app.staticTexts["story-\(hero)-title"]
        }
        app.buttons["story-comments"].tap()
        let page = app.descendants(matching: .any)["story-\(hero)"]
        XCTAssertTrue(page.descendants(matching: .any)["comment-\(theirs)"].waitForExistence(timeout: 10))
        return (app, page)
    }

    private func comment(_ page: XCUIElement, _ id: String) -> XCUIElement {
        page.descendants(matching: .any)["comment-\(id)"]
    }

    private func menu(_ page: XCUIElement, _ id: String) -> XCUIElement {
        page.buttons["comment-\(id)-menu"]
    }

    func testTheDockShowsTheConversation() {
        let (app, page) = openConversation()
        XCTAssertTrue(comment(page, other).exists && comment(page, mine).exists)
        XCTAssertEqual(app.buttons["story-comments"].value as? String, "3")
        let persona = page.staticTexts.matching(NSPredicate(format: "label ==[c] 'Commenting as Solar Jetty'")).firstMatch
        XCTAssertTrue(persona.exists, "the reader's persona")
    }

    func testTheFirstCommentAsksForTheRulesThenPosts() {
        let (app, page) = openConversation()
        page.buttons["comments-compose"].tap()
        XCTAssertTrue(app.buttons["rules-agree"].waitForExistence(timeout: 5), "the community rules come first")
        app.buttons["rules-agree"].tap()
        let input = app.textViews["comments-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["comments-post"].isEnabled, "nothing to post yet")
        app.typeText("A calm first take on the storm.")
        app.buttons["comments-post"].tap()
        XCTAssertTrue(page.staticTexts["A calm first take on the storm."].waitForExistence(timeout: 10))
        XCTAssertTrue(eventually("value == '4'", app.buttons["story-comments"]))
        page.buttons["comments-compose"].tap()
        XCTAssertTrue(app.textViews["comments-input"].waitForExistence(timeout: 5), "the rules are accepted once")
        XCTAssertFalse(app.buttons["rules-agree"].exists)
        app.buttons["comments-cancel"].tap()
    }

    func testTheServerScreenRefusesAbuse() {
        let (app, page) = openConversation()
        page.buttons["comments-compose"].tap()
        app.buttons["rules-agree"].tap()
        XCTAssertTrue(app.textViews["comments-input"].waitForExistence(timeout: 5))
        app.typeText("kys, all of you")
        app.buttons["comments-post"].tap()
        XCTAssertTrue(toast(app, "This comment breaks the community rules.").waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["comments-post"].exists, "the composer stays open with the draft")
    }

    func testReportingHidesTheCommentForTheReader() {
        let (app, page) = openConversation()
        menu(page, theirs).tap()
        app.buttons["Report"].firstMatch.tap()
        app.buttons["Spam or advertising"].firstMatch.tap()
        // the toast lasts 3.5 s: check it first
        XCTAssertTrue(toast(app, "Thanks — the comment was reported and hidden for you.").waitForExistence(timeout: 3))
        XCTAssertTrue(eventually("exists == false", comment(page, theirs)))
    }

    func testBlockingHidesTheCommenter() {
        let (app, page) = openConversation()
        menu(page, other).tap()
        app.buttons["Block Mellow Kestrel"].firstMatch.tap()
        XCTAssertTrue(toast(app, "You won’t see comments from Mellow Kestrel.").waitForExistence(timeout: 3))
        XCTAssertTrue(eventually("exists == false", comment(page, other)))
    }

    func testDeletingYourOwnComment() {
        let (app, page) = openConversation()
        menu(page, mine).tap()
        XCTAssertFalse(app.buttons["Block Solar Jetty"].exists, "no blocking yourself")
        app.buttons["Delete my comment"].firstMatch.tap()
        XCTAssertTrue(eventually("exists == false", comment(page, mine)))
        XCTAssertTrue(eventually("value == '2'", app.buttons["story-comments"]))
    }

    func testVotingOnAComment() {
        let (_, page) = openConversation()
        let up = page.buttons["comment-\(other)-up"]
        up.tap()
        XCTAssertTrue(eventually("value == '1'", up))
        up.tap()
        XCTAssertTrue(eventually("value == '0'", up))
    }
}
