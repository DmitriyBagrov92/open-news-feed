import XCTest

/// The screens reviewed at the visual checkpoints — scripts/screenshots.sh exports the attachments
/// to ios/screenshots/. Fixture newsroom by default; `SCREENSHOT_LIVE=1` (TEST_RUNNER_ prefix via
/// xcodebuild) photographs the live meridi.info feed with real photography. Not part of the gate.
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
