import CoreModels
import Dependencies
import Foundation
import Networking
import Observation

/// The source registry from `GET /api/sources`: the provenance fallback for bylines, the languages
/// with native feeds (the `lang=<target>,en` rule), and the Settings source list.
@MainActor
@Observable
public final class SourcesModel {
    public private(set) var response: SourcesResponse?
    public private(set) var registry: [String: Provenance] = [:]
    public private(set) var nativeLanguages: Set<String> = []

    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored private var loading = false

    public init() {}

    /// Loads once; a failure leaves the defaults (English feed, articles' own countries).
    public func load() async {
        guard response == nil, !loading else { return }
        loading = true
        defer { loading = false }
        guard let response = try? await api.sources() else { return }
        self.response = response
        registry = response.provenanceRegistry
        nativeLanguages = Set(response.languages)
    }
}
