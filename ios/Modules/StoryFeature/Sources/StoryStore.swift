import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Foundation
import Intelligence
import Networking
import Observation
import Persistence

/// Runs of an extracted block → one `AttributedString` (web modal.js:263-316): bold / italic as
/// inline intents, links only when absolute http(s) — no HTML ever crosses the wire.
public enum BlockText {
    public static func attributed(_ runs: [TextRun]) -> AttributedString {
        var text = AttributedString()
        for run in runs {
            var piece = AttributedString(run.text)
            var intent: InlinePresentationIntent = []
            if run.bold { intent.insert(.stronglyEmphasized) }
            if run.italic { intent.insert(.emphasized) }
            if !intent.isEmpty { piece.inlinePresentationIntent = intent }
            if let href = run.href, let scheme = href.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                piece.link = href
            }
            text.append(piece)
        }
        return text
    }
}

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

/// One story page (web modal.js `buildArticleView`): the extracted body — or the description with
/// "Full text unavailable" when extraction fails — the key points and the translation. Every page
/// starts fresh except for the extraction cache.
@MainActor
@Observable
public final class StoryStore {
    public enum Body: Equatable {
        case loading
        /// Structured blocks from the server (links, headings, lists, quotes, emphasis).
        case rich([ArticleBlock])
        /// Plain paragraphs of `text` (an extraction without blocks).
        case plain([String])
        /// Extraction failed (422, 403, offline…): the RSS description and the note.
        case fallback(String)
    }

    public struct Summary: Equatable {
        public let bullets: [String]
        public let provider: String
    }

    public struct Translation: Equatable {
        public let title: String
        public let blocks: [ArticleBlock]
    }

    public let article: Article
    public private(set) var body: Body = .loading
    public private(set) var summary: Summary?
    public private(set) var isSummarizing = false
    public private(set) var translation: Translation?
    public private(set) var showsTranslation = false
    public private(set) var isTranslating = false
    /// The conversation at the end of the story.
    public let comments: CommentsStore
    /// Bumped by the dock's 💬: the page scrolls to the comments.
    public private(set) var commentsScrollRequest = 0

    @ObservationIgnored private var extracted: ArticleBody?
    @ObservationIgnored private var loaded = false
    /// Bumped when the extraction lands: a translation made from the description is stale.
    @ObservationIgnored private var bodyGeneration = 0
    @ObservationIgnored private let preferences: PreferencesStore?
    @ObservationIgnored private let toasts: ToastCenter?
    @ObservationIgnored private let states: ArticleStateStore?
    @ObservationIgnored private let cache: ExtractionCache
    @ObservationIgnored @Dependency(\.meridianAPI) private var api
    @ObservationIgnored @Dependency(\.translator) private var translator
    @ObservationIgnored @Dependency(\.summarizer) private var summarizer

    public init(article: Article, preferences: PreferencesStore?, toasts: ToastCenter?, states: ArticleStateStore?,
                cache: ExtractionCache = .shared) {
        self.article = article
        self.preferences = preferences
        self.toasts = toasts
        self.states = states
        self.cache = cache
        comments = CommentsStore(article: article, preferences: preferences, toasts: toasts, states: states)
    }

    public func showComments() {
        commentsScrollRequest += 1
    }

    private var target: String { preferences?.value.targetLang ?? "en" }

    // MARK: Loading

    /// Extraction (cached per session), counters when the story came without them, then the
    /// auto-translation when the reader asked for it. Runs once per page.
    public func load() async {
        guard !loaded else { return }
        loaded = true
        async let counters: Void = fetchCountersIfMissing()
        if let cached = cache.body(for: article.id) {
            apply(cached)
        } else {
            do {
                let extracted = try await api.article(article.url)
                guard !extracted.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw APIError.decoding("empty extraction")
                }
                cache.store(extracted, for: article.id)
                apply(extracted)
            } catch {
                body = .fallback(article.description)
            }
        }
        await counters
        if preferences?.value.autoTranslate == true { await translate(manual: false) }
    }

    private func apply(_ extracted: ArticleBody) {
        self.extracted = extracted
        if let blocks = extracted.blocks?.filter({ !$0.isBlank }), !blocks.isEmpty {
            body = .rich(blocks)
        } else {
            body = .plain(extracted.paragraphs)
        }
        bodyGeneration += 1
        translation = nil
        showsTranslation = false
    }

    /// Saved and battle stories carry no counters: ask `/api/reactions` for this one id.
    private func fetchCountersIfMissing() async {
        guard let states, states.live(article).reactions == nil else { return }
        let epoch = states.voteEpoch
        guard let reactions = try? await api.reactions([article.id]) else { return }
        states.applyReactions(reactions, epoch: epoch)
    }

    /// Paragraphs as the web keeps them: the extracted text split on blank lines, or the description.
    var paragraphs: [String] {
        if let extracted { return extracted.paragraphs }
        return [article.description]
    }

    // MARK: Summarize ✦

    /// KEY POINTS (web modal.js:337-383): the summarize ladder; the local rung quotes the story's
    /// own language, so its bullets go through the translate ladder when the reader's differs.
    public func summarize() async {
        guard !isSummarizing else { return }
        isSummarizing = true
        defer { isSummarizing = false }
        let target = target
        let result = await summarizer.article(article.title, paragraphs.joined(separator: "\n\n"), target)
        var bullets = result.bullets
        if result.provider == "local", target != article.language,
           let translated = await translator.translate(bullets, target, article.language),
           translated.texts.count == bullets.count {
            bullets = translated.texts
        }
        summary = Summary(bullets: bullets, provider: result.provider)
    }

    // MARK: Translate

    /// Shows the story in the reader's language (web `doTranslate`): translated once, block by block
    /// — headings, quotes and lists keep their shape; inline links stay in the original only.
    /// `manual: false` is the quiet auto-translation (no toasts for what the reader didn't ask).
    public func translate(manual: Bool = true) async {
        let target = target
        guard target != article.language else {
            if manual { toasts?.show(L10n.t("lang.pick")) }
            return
        }
        if translation != nil {
            showsTranslation = true
            return
        }
        guard !isTranslating else { return }
        isTranslating = true
        defer { isTranslating = false }

        let generation = bodyGeneration
        let blocks = currentBlocks
        // one flat list: the title, then every block (list items one by one), chunked for the server
        var units: [[String]] = [[article.title]]
        for block in blocks {
            if case .list(_, let items) = block {
                units += items.map { TextKit.chunkParagraph($0.map(\.text).joined()) }
            } else {
                units.append(TextKit.chunkParagraph(block.plainText))
            }
        }
        let result = await translator.translate(units.flatMap { $0 }, target, article.language)
        guard generation == bodyGeneration else { return } // the extraction replaced the description meanwhile
        guard let result, result.texts.count == units.reduce(0, { $0 + $1.count }) else {
            if manual { toasts?.show(L10n.t("lang.unavailable")) }
            return
        }
        var cursor = result.texts.startIndex
        var unit = units.startIndex
        func next() -> [TextRun] {
            let count = units[unit].count
            defer { cursor += count; unit += 1 }
            return [TextRun(text: result.texts[cursor..<(cursor + count)].joined(separator: " "))]
        }
        let title = next().first?.text ?? article.title
        let translated: [ArticleBlock] = blocks.map { block in
            switch block {
            case .paragraph: return .paragraph(next())
            case .heading(let level, _): return .heading(level: level, next())
            case .quote: return .quote(next())
            case .list(let ordered, let items): return .list(ordered: ordered, items: items.map { _ in next() })
            }
        }
        translation = Translation(title: title, blocks: translated)
        showsTranslation = true
    }

    /// The chip: translated ⇄ original.
    public func toggleVersion() {
        guard translation != nil else { return }
        showsTranslation.toggle()
    }

    /// The body as blocks, whatever shape it arrived in.
    public var currentBlocks: [ArticleBlock] {
        switch body {
        case .rich(let blocks): return blocks
        case .plain(let paragraphs): return paragraphs.map { .paragraph([TextRun(text: $0)]) }
        case .fallback(let text): return Self.blocks(text)
        case .loading: return Self.blocks(article.description)
        }
    }

    private static func blocks(_ text: String) -> [ArticleBlock] {
        let block = ArticleBlock.paragraph([TextRun(text: text)])
        return block.isBlank ? [] : [block]
    }

    /// What the page shows now: the translation when chosen, otherwise the original.
    public var displayedTitle: String { showsTranslation ? translation?.title ?? article.title : article.title }
    public var displayedBlocks: [ArticleBlock] { showsTranslation ? translation?.blocks ?? currentBlocks : currentBlocks }
}

/// The pages' stores, created on first view and kept while the pager lives.
@MainActor
final class StoryStorePool {
    private var stores: [String: StoryStore] = [:]

    func store(for article: Article, preferences: PreferencesStore?, toasts: ToastCenter?, states: ArticleStateStore?) -> StoryStore {
        if let store = stores[article.id] { return store }
        let store = StoryStore(article: article, preferences: preferences, toasts: toasts, states: states)
        stores[article.id] = store
        return store
    }
}
