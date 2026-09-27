import XCTest

/// P10: launch and scrolling measured with XCTest metrics (hitch ratio while the feed and the
/// Battle arena scroll). Slow and noisy on a shared simulator, so outside the gate: run with
/// `TEST_RUNNER_PERF=1` (see ios/CLAUDE.md) and compare against the numbers recorded there.
final class PerformanceTests: AcceptanceTestCase {
    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["PERF"] == "1", "set TEST_RUNNER_PERF=1 to measure")
    }

    func testLaunch() {
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTApplicationLaunchMetric(waitUntilResponsive: true)], options: options) {
            let app = XCUIApplication()
            app.launchArguments = [LaunchContract.uiTestMode]
            app.launchEnvironment[LaunchContract.Env.fixturesDir] = LaunchContract.fixturesDirectory()
            app.launch()
        }
    }

    func testTodayScrolling() {
        let app = launch()
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            app.swipeUp(velocity: .fast)
            app.swipeUp(velocity: .fast)
            app.swipeDown(velocity: .fast)
            app.swipeDown(velocity: .fast)
        }
    }

    func testBattleScrolling() {
        let app = launch([LaunchContract.Env.initialRoute: "battle"]) { app in app.descendants(matching: .any)["battle-legend"] }
        let options = XCTMeasureOptions()
        options.iterationCount = 3
        measure(metrics: [XCTOSSignpostMetric.scrollingAndDecelerationMetric], options: options) {
            app.swipeUp(velocity: .fast)
            app.swipeDown(velocity: .fast)
        }
    }
}
