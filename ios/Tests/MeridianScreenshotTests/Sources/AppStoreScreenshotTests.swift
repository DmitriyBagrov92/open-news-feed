import XCTest

/// The App Store screenshots: scripts/appstore-screenshots.sh runs this suite on the 6.9" iPhone
/// and the 13" iPad (landscape) and exports the attachments to ios/screenshots/appstore/. The world
/// is the App Store newsroom (scripts/newsroom.mjs) — invented outlets and stories, public-domain
/// photography, the on-device model scripted (FAKE_MODEL=showcase) — as of today's 9:41, from
/// NEWSROOM_DIR (the status bar keeps the real date, so the app's has to match). Skipped unless
/// NEWSROOM=1 (TEST_RUNNER_ prefix via xcodebuild), so scripts/screenshots.sh never runs it.
@MainActor
final class AppStoreScreenshotTests: XCTestCase {
    /// The newsroom's story-a (Storm Idris: photo, rich text, the conversation) — CREDITS.md.
    private static let storyA = "947fb228292d"
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    private var newsroom: String { ProcessInfo.processInfo.environment["NEWSROOM_DIR"] ?? LaunchContract.newsroomDirectory() }

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["NEWSROOM"] == "1", "App Store screenshots: scripts/appstore-screenshots.sh")
        continueAfterFailure = true
    }

    /// Today: the freshest stories under the on-device brief.
    func test1Today() {
        let app = launch("light")
        waitForBrief(app)
        shoot("01-today")
    }

    /// A story and its key points, written on the device.
    func test2Story() {
        let app = launch("light", ["INITIAL_ROUTE": "story/\(Self.storyA)"])
        XCTAssertTrue(app.staticTexts["story-\(Self.storyA)-title"].waitForExistence(timeout: 30))
        pause(1.5)
        app.buttons["story-summarize"].tap()
        XCTAssertTrue(text(app, "Every ferry crossing is suspended").waitForExistence(timeout: 15))
        pause(1.5)
        shoot("02-story")
    }

    /// Bubble Battle: the arena on iPad, the lean lanes on iPhone.
    func test3Battle() {
        let app = launch("light", ["INITIAL_ROUTE": "battle"])
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: "battle-brief").firstMatch.waitForExistence(timeout: 30))
        pause(2.5) // the arena settles — and has not yet sent two tiles at each other (every 4.5 s)
        shoot("03-battle")
    }

    /// Ahead: the speculative forecast, labelled as such.
    func test4Ahead() {
        let app = launch("light", ["INITIAL_ROUTE": "ahead"])
        let sheet = app.descendants(matching: .any)["forecast"]
        XCTAssertTrue(sheet.descendants(matching: .any).matching(identifier: "fcard").element(boundBy: 3).waitForExistence(timeout: 30))
        pause(1.5)
        shoot("04-ahead")
    }

    /// Your Feed, ranked for a reader who likes science and culture.
    func test5YourFeed() {
        let taste = #"{"taste":{"count":6,"sources":["fieldline",4,"velvet-aisle",3],"cats":["science",4,"culture",3],"tokens":[],"rated":[]}}"#
        let app = launch("light", ["INITIAL_ROUTE": "yourFeed", "SEED_PREFS": taste])
        XCTAssertTrue(app.buttons["tune-more"].waitForExistence(timeout: 30))
        pause(2.5)
        shoot("05-your-feed")
    }

    /// The conversation under a story: anonymous, moderated.
    func test6Conversation() {
        let app = launch("light", ["INITIAL_ROUTE": "story/\(Self.storyA)"])
        let page = app.descendants(matching: .any)["story-\(Self.storyA)"]
        XCTAssertTrue(app.staticTexts["story-\(Self.storyA)-title"].waitForExistence(timeout: 30))
        pause(1.5)
        app.buttons["story-comments"].tap()
        XCTAssertTrue(page.descendants(matching: .any)["comment-cc00000000000002"].waitForExistence(timeout: 10))
        pause(1.5)
        shoot("06-conversation")
    }

    /// Further down Today, after dark.
    func test7TodayDark() {
        let app = launch("dark")
        waitForBrief(app)
        app.swipeUp(velocity: .slow)
        pause(2.5)
        shoot("07-today-dark")
    }

    // MARK: -

    private func launch(_ appearance: String, _ environment: [String: String] = [:]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [LaunchContract.uiTestMode]
        app.launchEnvironment[LaunchContract.Env.fixturesDir] = newsroom
        app.launchEnvironment[LaunchContract.Env.fakeModel] = "showcase"
        app.launchEnvironment[LaunchContract.Env.appearance] = appearance
        for (key, value) in environment { app.launchEnvironment[key] = value }
        if isPad { XCUIDevice.shared.orientation = .landscapeLeft } // before the launch: no rotation to wait out
        app.launch()
        return app
    }

    private func waitForBrief(_ app: XCUIApplication) {
        XCTAssertTrue(text(app, "Storm Idris is due to make landfall").waitForExistence(timeout: 30))
        pause(2.5) // the photographs fade in
    }

    private func text(_ app: XCUIApplication, _ fragment: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    private func pause(_ seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds)
    }

    private func shoot(_ name: String) {
        // the whole screen, redrawn upright: the raw capture is the panel's native portrait buffer
        let raw = XCUIScreen.main.screenshot().image
        let format = UIGraphicsImageRendererFormat()
        format.scale = raw.scale
        let upright = UIGraphicsImageRenderer(size: raw.size, format: format).image { _ in
            raw.draw(in: CGRect(origin: .zero, size: raw.size))
        }
        let attachment = XCTAttachment(image: upright)
        attachment.name = "\(isPad ? "ipad" : "iphone")-\(name)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
