import XCTest

/// The screens reviewed at the visual checkpoints — scripts/screenshots.sh exports the attachments
/// to ios/screenshots/. Fixture newsroom by default; `SCREENSHOT_LIVE=1` (TEST_RUNNER_ prefix via
/// xcodebuild) photographs the live meridi.info feed with real photography. Not part of the gate.
@MainActor
final class ScreenshotTests: XCTestCase {
    private var live: Bool { ProcessInfo.processInfo.environment["SCREENSHOT_LIVE"] == "1" }
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    override func setUp() {
        continueAfterFailure = true
    }

    func testFeedLight() { capture(appearance: "light") }

    func testFeedDark() { capture(appearance: "dark") }

    private func capture(appearance: String) {
        let app = XCUIApplication()
        if !live {
            app.launchArguments = [LaunchContract.uiTestMode]
            app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
        }
        app.launchEnvironment[LaunchContract.Env.appearance] = appearance
        app.launch()
        if isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            pause(2)
        }
        _ = app.staticTexts["BRIEF"].waitForExistence(timeout: 30)
        pause(live ? 6 : 2)
        let device = isPad ? "ipad" : "iphone"
        shoot(app, "\(device)-\(appearance)-1-top")
        for step in 2...4 {
            app.swipeUp(velocity: .slow)
            pause(live ? 3 : 1)
            shoot(app, "\(device)-\(appearance)-\(step)-scrolled")
        }
    }

    func testStoryLight() { captureStory(appearance: "light") }

    func testStoryDark() { captureStory(appearance: "dark") }

    /// The story view: fixture story-a (German as the reader's language, to show the translation), or
    /// live the first story of the real feed opened from its photo.
    private func captureStory(appearance: String) {
        let app = XCUIApplication()
        if !live {
            app.launchArguments = [LaunchContract.uiTestMode]
            app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
            app.launchEnvironment[LaunchContract.Env.initialRoute] = "story/825452304de0"
            app.launchEnvironment[LaunchContract.Env.seedPrefs] = #"{"targetLang":"de"}"#
        }
        app.launchEnvironment[LaunchContract.Env.appearance] = appearance
        app.launch()
        if isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            pause(2)
        }
        if live {
            _ = app.staticTexts["BRIEF"].waitForExistence(timeout: 30)
            pause(4)
            let headline = app.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier MATCHES 'card-[0-9a-f]+'")).firstMatch
            headline.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: -120)).tap()
        }
        let story = app.descendants(matching: .any)["story"]
        _ = story.waitForExistence(timeout: 20)
        pause(live ? 5 : 2)
        let device = isPad ? "ipad" : "iphone"
        shoot(app, "\(device)-\(appearance)-story-1-top")
        app.buttons["story-summarize"].tap()
        pause(live ? 5 : 1.5)
        story.swipeUp(velocity: .slow)
        pause(1.5)
        shoot(app, "\(device)-\(appearance)-story-2-summary")
        if !live {
            app.buttons["story-translate"].tap()
            pause(2)
            shoot(app, "\(device)-\(appearance)-story-3-translated")
        }
    }

    func testConversationLight() throws { try captureConversation(appearance: "light") }

    func testConversationDark() throws { try captureConversation(appearance: "dark") }

    /// Story-a's comments, a commenter's menu (report / block) and the community rules that come
    /// before the first comment.
    private func captureConversation(appearance: String) throws {
        try XCTSkipIf(live, "the fixture conversation")
        let app = fixtureApp(appearance, ["INITIAL_ROUTE": "story/825452304de0"])
        let page = app.descendants(matching: .any)["story-825452304de0"]
        _ = app.staticTexts["story-825452304de0-title"].waitForExistence(timeout: 30)
        pause(1.5)
        app.buttons["story-comments"].tap()
        _ = page.descendants(matching: .any)["comment-cc00000000000002"].waitForExistence(timeout: 10)
        pause(1.5)
        let device = isPad ? "ipad" : "iphone"
        shoot(app, "\(device)-\(appearance)-conversation-1-comments")
        page.buttons["comment-cc00000000000002-menu"].tap()
        pause(1.2)
        shoot(app, "\(device)-\(appearance)-conversation-2-menu")
        app.buttons["Report"].firstMatch.tap()
        pause(1.2)
        shoot(app, "\(device)-\(appearance)-conversation-3-report")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.3)).tap() // outside: the menu closes
        pause(1)
        page.buttons["comments-compose"].tap()
        _ = app.buttons["rules-agree"].waitForExistence(timeout: 5)
        pause(1.2)
        shoot(app, "\(device)-\(appearance)-conversation-4-rules")
    }

    func testTranslatedFeed() throws {
        try XCTSkipIf(live, "the fake on-device translator")
        let app = fixtureApp("light", [
            "SEED_PREFS": #"{"targetLang":"de","autoTranslate":true}"#,
            "FAKE_TRANSLATION": "installed",
        ])
        _ = app.staticTexts["BRIEF"].waitForExistence(timeout: 30)
        pause(3)
        shoot(app, "\(isPad ? "ipad" : "iphone")-light-feed-translated")
    }

    /// The app on the fixture newsroom (landscape on iPad).
    private func fixtureApp(_ appearance: String, _ environment: [String: String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [LaunchContract.uiTestMode]
        app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
        app.launchEnvironment[LaunchContract.Env.appearance] = appearance
        for (key, value) in environment { app.launchEnvironment[key] = value }
        app.launch()
        if isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            pause(2)
        }
        return app
    }

    func testAheadLight() throws { try captureAhead(appearance: "light") }

    func testAheadDark() throws { try captureAhead(appearance: "dark") }

    /// The Ahead sheet and the on-device brief with the fake model (the simulator has no Apple
    /// Intelligence, so there is no live variant).
    private func captureAhead(appearance: String) throws {
        try XCTSkipIf(live, "the simulator has no on-device model")
        let app = XCUIApplication()
        app.launchArguments = [LaunchContract.uiTestMode]
        app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
        app.launchEnvironment[LaunchContract.Env.fakeModel] = "points"
        app.launchEnvironment[LaunchContract.Env.initialRoute] = "ahead"
        app.launchEnvironment[LaunchContract.Env.appearance] = appearance
        app.launch()
        if isPad {
            XCUIDevice.shared.orientation = .landscapeLeft
            pause(2)
        }
        let sheet = app.descendants(matching: .any)["forecast"]
        _ = sheet.descendants(matching: .any).matching(identifier: "fcard").element(boundBy: 3).waitForExistence(timeout: 30)
        pause(1.5)
        let device = isPad ? "ipad" : "iphone"
        shoot(app, "\(device)-\(appearance)-ahead-1-sheet")
        if !isPad {
            sheet.swipeUp()
            pause(1.5)
        }
        sheet.descendants(matching: .any).matching(identifier: "fcard-title").firstMatch.tap()
        pause(1)
        shoot(app, "\(device)-\(appearance)-ahead-2-open")
        app.buttons["forecast-close"].tap()
        pause(1.5)
        shoot(app, "\(device)-\(appearance)-ahead-3-brief")
    }

    private func pause(_ seconds: TimeInterval) {
        Thread.sleep(forTimeInterval: seconds)
    }

    private func shoot(_ app: XCUIApplication, _ name: String) {
        // the whole screen, redrawn upright: the raw capture is the panel's native portrait buffer
        let raw = XCUIScreen.main.screenshot().image
        let format = UIGraphicsImageRendererFormat()
        format.scale = raw.scale
        let upright = UIGraphicsImageRenderer(size: raw.size, format: format).image { _ in
            raw.draw(in: CGRect(origin: .zero, size: raw.size))
        }
        let attachment = XCTAttachment(image: upright)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
