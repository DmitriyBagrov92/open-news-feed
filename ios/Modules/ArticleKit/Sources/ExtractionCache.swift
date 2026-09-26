import CoreModels
import Foundation

/// The last 30 extracted bodies of this session, least recently read evicted first: a story
/// revisited through prev/next does not hit `/api/article` again (30 requests/min per IP).
@MainActor
public final class ExtractionCache {
    public static let shared = ExtractionCache()
    private var order: [String] = [] // least recently used first
    private var bodies: [String: ArticleBody] = [:]
    private let capacity: Int

    public init(capacity: Int = 30) {
        self.capacity = capacity
    }

    public func body(for id: String) -> ArticleBody? {
        guard let body = bodies[id] else { return nil }
        touch(id)
        return body
    }

    public func store(_ body: ArticleBody, for id: String) {
        bodies[id] = body
        touch(id)
        while order.count > capacity { bodies[order.removeFirst()] = nil }
    }

    private func touch(_ id: String) {
        order.removeAll { $0 == id }
        order.append(id)
    }
}
