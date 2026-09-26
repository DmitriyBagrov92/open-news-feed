import CoreModels
import Dependencies
import Foundation
import Observation
import SwiftData

/// A saved story: the whole Article as it was when saved (the Saved tab works offline — web
/// `prefs.saved`), newest first. Onboarding likes land here too (web: "a like is a save").
@Model
final class SavedItem {
    #Index<SavedItem>([\.articleID], [\.savedAt])

    var articleID: String
    /// JSON of the `Article` snapshot (not queried; avoids Codable-property edge cases).
    var payload: Data
    var savedAt: Date
    /// JSON of the extracted `ArticleBody`: the story reads offline. Never fetched with the list.
    var body: Data?

    init(articleID: String, payload: Data, savedAt: Date) {
        self.articleID = articleID
        self.payload = payload
        self.savedAt = savedAt
    }
}

/// SwiftData behind an actor; callers get Sendable `Article`s, never models. Upserts are
/// defensive (fetch-or-create) — `#Unique` is not relied on.
@ModelActor
actor LibraryDatabase {
    func all() throws -> [Article] {
        var descriptor = FetchDescriptor<SavedItem>(sortBy: [SortDescriptor(\.savedAt, order: .reverse)])
        descriptor.propertiesToFetch = [\.articleID, \.payload, \.savedAt] // not the bodies
        let decoder = JSONDecoder()
        return try modelContext.fetch(descriptor).compactMap { try? decoder.decode(Article.self, from: $0.payload) }
    }

    func save(_ article: Article, at date: Date) throws {
        let id = article.id
        let payload = try JSONEncoder().encode(article)
        let existing = try modelContext.fetch(FetchDescriptor<SavedItem>(predicate: #Predicate { $0.articleID == id }))
        if let first = existing.first {
            first.payload = payload
            first.savedAt = date
            existing.dropFirst().forEach(modelContext.delete)
        } else {
            modelContext.insert(SavedItem(articleID: id, payload: payload, savedAt: date))
        }
        try modelContext.save()
    }

    func body(_ id: String) throws -> Data? {
        try modelContext.fetch(FetchDescriptor<SavedItem>(predicate: #Predicate { $0.articleID == id })).first?.body
    }

    /// Only for a story that is saved: a body never creates an entry.
    func storeBody(_ id: String, _ data: Data) throws {
        guard let item = try modelContext.fetch(FetchDescriptor<SavedItem>(predicate: #Predicate { $0.articleID == id })).first else { return }
        item.body = data
        try modelContext.save()
    }

    func remove(_ id: String) throws {
        try modelContext.fetch(FetchDescriptor<SavedItem>(predicate: #Predicate { $0.articleID == id })).forEach(modelContext.delete)
        try modelContext.save()
    }
}

/// The library as an injectable client: on disk in the app, in memory in tests and UI tests.
public struct LibraryClient: Sendable {
    public var all: @Sendable () async throws -> [Article]
    public var save: @Sendable (Article) async throws -> Void
    public var remove: @Sendable (String) async throws -> Void
    /// The kept text of a saved story (JSON `ArticleBody`), if any.
    public var body: @Sendable (String) async throws -> Data?
    public var storeBody: @Sendable (String, Data) async throws -> Void

    public init(all: @escaping @Sendable () async throws -> [Article],
                save: @escaping @Sendable (Article) async throws -> Void,
                remove: @escaping @Sendable (String) async throws -> Void,
                body: @escaping @Sendable (String) async throws -> Data? = { _ in nil },
                storeBody: @escaping @Sendable (String, Data) async throws -> Void = { _, _ in }) {
        self.all = all
        self.save = save
        self.remove = remove
        self.body = body
        self.storeBody = storeBody
    }

    public static func swiftData(inMemory: Bool) -> LibraryClient {
        let configuration: ModelConfiguration
        if inMemory {
            configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        } else {
            let folder = URL.applicationSupportDirectory.appending(path: "Meridian", directoryHint: .isDirectory)
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            configuration = ModelConfiguration(url: folder.appending(path: "library.store"))
        }
        guard let container = try? ModelContainer(for: SavedItem.self, configurations: configuration) else {
            return .unavailable
        }
        let database = LibraryDatabase(modelContainer: container)
        return LibraryClient(
            all: { try await database.all() },
            save: { article in try await database.save(article, at: Date()) },
            remove: { id in try await database.remove(id) },
            body: { id in try await database.body(id) },
            storeBody: { id, data in try await database.storeBody(id, data) }
        )
    }

    /// Storage could not be opened: the Saved tab stays empty, nothing crashes.
    public static let unavailable = LibraryClient(all: { [] }, save: { _ in }, remove: { _ in })
}

extension LibraryClient: DependencyKey {
    public static var liveValue: LibraryClient { .swiftData(inMemory: false) }
    public static var testValue: LibraryClient { .swiftData(inMemory: true) }
}

public extension DependencyValues {
    var library: LibraryClient {
        get { self[LibraryClient.self] }
        set { self[LibraryClient.self] = newValue }
    }
}

/// The saved stories for the UI: newest first, plus a fast membership set for card state.
@MainActor
@Observable
public final class LibraryModel {
    public private(set) var articles: [Article] = []
    public private(set) var ids: Set<String> = []
    public private(set) var isLoaded = false

    @ObservationIgnored private let client: LibraryClient

    public init(client: LibraryClient? = nil) {
        @Dependency(\.library) var injected
        self.client = client ?? injected
    }

    public func load() async {
        let loaded = (try? await client.all()) ?? []
        articles = loaded
        ids = Set(loaded.map(\.id))
        isLoaded = true
    }

    public func contains(_ id: String) -> Bool { ids.contains(id) }

    /// Web `toggleSaved`: unsave when saved, otherwise keep the live snapshot at the front.
    /// Returns whether the story ends up saved.
    @discardableResult
    public func toggle(_ article: Article) async -> Bool {
        if ids.contains(article.id) {
            await remove(article.id)
            return false
        }
        await save(article)
        return true
    }

    /// Save without toggling (onboarding "like" never un-saves).
    public func save(_ article: Article) async {
        articles.removeAll { $0.id == article.id }
        articles.insert(article, at: 0)
        ids.insert(article.id)
        try? await client.save(article)
    }

    /// The text kept with a saved story, for reading offline.
    public func body(for id: String) async -> ArticleBody? {
        guard ids.contains(id), let data = try? await client.body(id) else { return nil }
        return try? JSONDecoder().decode(ArticleBody.self, from: data)
    }

    /// Keeps a saved story's text (ignored for a story that is not saved).
    public func storeBody(_ body: ArticleBody, for id: String) async {
        guard ids.contains(id), let data = try? JSONEncoder().encode(body) else { return }
        try? await client.storeBody(id, data)
    }

    public func remove(_ id: String) async {
        articles.removeAll { $0.id == id }
        ids.remove(id)
        try? await client.remove(id)
    }
}
