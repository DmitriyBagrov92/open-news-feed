import Foundation
import Intelligence
import Networking

public extension OnDeviceTranslation {
    /// A stand-in for Apple's translator: "[on-device de] text" for every pair once installed;
    /// `prepare` (the download sheet the reader confirms) installs it at once.
    static func fake(installed: Bool) -> OnDeviceTranslation {
        let state = LockedValue(installed)
        return OnDeviceTranslation(
            availability: { _, _ in state.value ? .installed : .downloadable },
            translate: { texts, _, target in
                guard state.value else { throw CancellationError() }
                return texts.map { $0.isEmpty ? $0 : "[on-device \(target)] \($0)" }
            },
            prepare: { _, _ in
                state.update { $0 = true }
                return true
            }
        )
    }
}
