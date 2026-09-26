import XCTest

/// P9 acceptance: Bubble Battle — the iOS counterpart of the web's battle spec: the clusters with
/// their HOW COVERAGE DIFFERS, a tile opening its story with the other viewpoints next to it, and
/// on iPad the arena's tiles in the reader's hands.
final class BattleAcceptanceTests: AcceptanceTestCase {
    // the first fixture cluster: Supreme Court (left: The Guardian, The Nation, Salon · center: The
    // Hill · right: Fox News, New York Post), in the server's order
    private let guardian = "b52427f78777"
    private let hill = "3380cca8ad67"
    private let fox = "1019eef837e4"

    private func bubble(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)["bubble-\(id)"].firstMatch
    }

    private func openBattle() -> XCUIApplication {
        launch([LaunchContract.Env.initialRoute: "battle"]) { app in app.descendants(matching: .any)["battle-legend"] }
    }

    func testEachStoryShowsHowItsCoverageDiffers() {
        let app = openBattle()
        let brief = app.descendants(matching: .any).matching(identifier: "battle-brief").firstMatch
        XCTAssertTrue(brief.waitForExistence(timeout: 10))
        XCTAssertTrue(eventually("label CONTAINS 'HOW COVERAGE DIFFERS'", brief), brief.label)
        XCTAssertTrue(eventually("label CONTAINS 'supportive of Supreme Court'", brief), "the right's stance with its receipt")
        XCTAssertTrue(bubble(app, guardian).exists && bubble(app, fox).exists)
        XCTAssertTrue(bubble(app, guardian).label.contains("The Guardian"))
    }

    func testATileOpensItsStoryWithTheOtherViewpointsBesideIt() {
        let app = openBattle()
        let tile = bubble(app, guardian)
        XCTAssertTrue(tile.waitForExistence(timeout: 10))
        tile.tap()
        XCTAssertTrue(app.staticTexts["story-\(guardian)-title"].waitForExistence(timeout: 10))
        if isPad {
            app.buttons["story-next"].tap()
        } else {
            app.swipeLeft()
        }
        XCTAssertTrue(app.staticTexts["story-\(hill)-title"].waitForExistence(timeout: 10), "the next viewpoint of the same story")
    }

    func testTheBriefKeepsItsRoomWhenTheArenaIsRebuilt() throws {
        try XCTSkipUnless(isPad, "the arena is the wide-window layout")
        let app = openBattle()
        let brief = app.descendants(matching: .any).matching(identifier: "battle-brief").firstMatch
        XCTAssertTrue(eventually("label CONTAINS 'HOW COVERAGE DIFFERS'", brief))
        XCUIDevice.shared.orientation = .landscapeLeft // a new width: the arena is laid out again
        defer { XCUIDevice.shared.orientation = .portrait }
        Thread.sleep(forTimeInterval: 4)
        let area = brief.frame.insetBy(dx: 6, dy: 6)
        for id in [guardian, hill, fox] {
            XCTAssertFalse(bubble(app, id).frame.intersects(area), "\(id) lies on the brief")
        }
    }

    func testArenaTilesCanBeDragged() throws {
        try XCTSkipUnless(isPad, "the arena is the wide-window layout")
        let app = openBattle()
        let tile = bubble(app, fox)
        XCTAssertTrue(tile.waitForExistence(timeout: 10))
        let before = tile.frame
        let start = tile.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.4, thenDragTo: start.withOffset(CGVector(dx: -260, dy: 160)))
        let after = tile.frame
        XCTAssertGreaterThan(hypot(after.midX - before.midX, after.midY - before.midY), 60, "the tile followed the finger")
    }
}
