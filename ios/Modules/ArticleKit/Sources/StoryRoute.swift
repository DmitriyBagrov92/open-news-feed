import CoreModels
import Foundation
import SwiftUI

/// Opening a story: the story plus the list it was opened from — prev/next walk that list (web
/// `getAdjacent`: the feed as rendered, the Saved list, a battle's viewpoints). Identity is the
/// route itself, so hashing never touches the (possibly long) context.
public struct StoryRoute: Hashable, Identifiable, Sendable {
    public let id: UUID
    public let articleID: String
    public let context: [Article]

    public init(article: Article, context: [Article]) {
        id = UUID()
        articleID = article.id
        self.context = context.contains { $0.id == article.id } ? context : [article]
    }

    public var article: Article? { context.first { $0.id == articleID } }

    public static func == (lhs: StoryRoute, rhs: StoryRoute) -> Bool { lhs.id == rhs.id }
    public func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

/// The environment action every card uses to open a story; the app decides push vs. pane.
/// Equatable by `id`: an environment value SwiftUI cannot compare counts as changed on every
/// write, and every card reading it would update — per frame while the feed scrolls.
public struct OpenStoryAction: Equatable {
    private let id: AnyHashable
    private let handler: @MainActor (Article, [Article]) -> Void

    /// - Parameter id: equal ids promise the same behaviour (e.g. the tab and the size class).
    public init(id: AnyHashable, _ handler: @escaping @MainActor (Article, [Article]) -> Void) {
        self.id = id
        self.handler = handler
    }

    @MainActor
    public func callAsFunction(_ article: Article, in context: [Article]) {
        handler(article, context)
    }

    public static func == (lhs: OpenStoryAction, rhs: OpenStoryAction) -> Bool { lhs.id == rhs.id }
}

/// The list a card belongs to — prev/next in the story walk it (web `getAdjacent`: the feed as
/// rendered). A reference the surface keeps and cards read only when tapped, so a growing feed
/// never changes the environment under every card.
@MainActor
public protocol StoryListSource: AnyObject, Sendable {
    var storyList: [Article] { get }
}

/// A `StoryListSource` for surfaces without a store of their own (e.g. filtered Saved).
@MainActor
public final class StoryList: StoryListSource {
    public var storyList: [Article]

    public init(_ articles: [Article] = []) {
        storyList = articles
    }
}

/// The environment's handle on a `StoryListSource`, compared by identity (see `OpenStoryAction`).
public struct StoryListRef: Equatable {
    public let source: any StoryListSource

    public init(_ source: any StoryListSource) {
        self.source = source
    }

    public static func == (lhs: StoryListRef, rhs: StoryListRef) -> Bool { lhs.source === rhs.source }
}

public extension EnvironmentValues {
    @Entry var openStory: OpenStoryAction? = nil
    /// Set by the surface rendering the cards.
    @Entry var storyList: StoryListRef? = nil
    /// Set on compact width: cards become zoom-transition sources for the story they open.
    @Entry var storyZoomNamespace: Namespace.ID? = nil
}

extension View {
    /// Marks a card as the source of the zoom into its story (compact width only).
    @ViewBuilder
    func storyZoomSource(id: String, namespace: Namespace.ID?) -> some View {
        if let namespace {
            matchedTransitionSource(id: id, in: namespace)
        } else {
            self
        }
    }
}
