import XCTest

/// P6 acceptance: the translation ladder in the app — auto-translation of the cards on screen, the
/// on-device rung when the language is installed, the download offered when the reader asks.
/// The fixture server answers "[de] …", the fake device "[on-device de] …".
final class TranslationAcceptanceTests: AcceptanceTestCase {
    private let german = #"{"targetLang":"de","autoTranslate":true}"#

    func testAutoTranslateUsesTheServerWhenTheDeviceCannot() {
        let app = launch([LaunchContract.Env.seedPrefs: german])
        XCTAssertTrue(eventually("label CONTAINS '[de] '", card(app, hero), timeout: 15))
        XCTAssertFalse(card(app, hero).label.contains("[on-device"))
    }

    func testAnInstalledLanguageTranslatesOnTheDevice() {
        let app = launch([LaunchContract.Env.seedPrefs: german, LaunchContract.Env.fakeTranslation: "installed"])
        XCTAssertTrue(eventually("label CONTAINS '[on-device de] '", card(app, hero), timeout: 15))
    }

    func testAskingForATranslationOffersTheDownloadFirst() {
        // auto-translate off: nothing happens until the reader asks
        let app = launch([LaunchContract.Env.seedPrefs: #"{"targetLang":"de"}"#, LaunchContract.Env.fakeTranslation: "downloadable"])
        let translate = app.buttons["card-\(row)-translate"]
        XCTAssertTrue(scroll(app, until: translate, maxSwipes: 3))
        XCTAssertFalse(card(app, row).label.contains("[de]"))
        translate.tap()
        XCTAssertTrue(eventually("label CONTAINS '[on-device de] '", card(app, row), timeout: 10), "downloaded, then on the device")
    }
}
