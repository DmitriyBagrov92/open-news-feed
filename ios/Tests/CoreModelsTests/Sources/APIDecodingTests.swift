import Foundation
import Testing
import CoreModels

/// The Swift models decode what the real server sends (fixtures captured from server.js in
/// fixture mode) — nothing is dropped, tri-state fields keep their meaning, errors carry codes.
@Suite("API decoding against captured server fixtures")
struct APIDecodingTests {
    @Test("every news response decodes without dropping a story")
    func newsPages() throws {
        for name in try Fixtures.apiNames() where name.hasPrefix("news-") && !name.contains("vote") {
            let exchange = try Fixtures.api(name)
            let raw = (exchange.json as? [String: Any])?["articles"] as? [Any] ?? []
            let page = try JSONDecoder().decode(FeedPage.self, from: exchange.body)
            #expect(page.articles.count == raw.count, "\(name): decoded \(page.articles.count) of \(raw.count)")
        }
    }

    @Test("page 1: order, fields, counters and paging totals")
    func pageOne() throws {
        let page = try Fixtures.decodeAPI(FeedPage.self, "news-page1")
        #expect(page.articles.count == 30)
        #expect(page.total == 73)
        #expect(page.page == 1 && page.pageSize == 30)
        #expect(page.latestId == page.articles.first?.id)
        #expect(page.updatedAt?.iso == "2026-09-26T12:00:00.000Z")
        let dates = page.articles.map(\.publishedAt)
        #expect(dates == dates.sorted(by: >), "always newest first")

        let lead = try #require(page.articles.first)
        #expect(ArticleID.isValid(lead.id))
        #expect(lead.source.id == "bbc-world")
        #expect(lead.source.provenance == .country("GB"))
        #expect(lead.url.absoluteString == "https://www.bbc.com/fixture/story-a")
        #expect(lead.reactions == Reactions(comments: 0, up: 0, down: 0, myVote: nil))
        #expect(lead.newsCategory == .world)
        #expect(page.articles.contains { $0.image == nil }, "text cards exist on page 1")
    }

    @Test("an author's vote comes back as myVote on the feed")
    func myVoteOnFeed() throws {
        let page = try Fixtures.decodeAPI(FeedPage.self, "news-page1-author")
        let lead = try #require(page.articles.first)
        #expect(lead.reactions?.myVote == .down)
        #expect(lead.reactions?.comments == 3)
    }

    @Test("native-language feeds mix in with lang=de,en")
    func nativeLanguages() throws {
        let page = try Fixtures.decodeAPI(FeedPage.self, "news-all-de")
        #expect(page.articles.contains { $0.language == "de" })
        #expect(page.articles.contains { $0.language == "en" })
    }

    @Test("sources: registry fields, keyed and battle-only sources, native languages")
    func sources() throws {
        let response = try Fixtures.decodeAPI(SourcesResponse.self, "sources")
        #expect(response.sources.count == 88)
        #expect(response.languages == ["en", "ru", "uk", "de", "fr", "es", "ja", "zh"])
        #expect(response.categories == NewsCategory.feed.map(\.rawValue))
        let gnews = try #require(response.sources.first { $0.id == "gnews" })
        #expect(gnews.provenance == .international && !gnews.enabled && gnews.requiresKey && gnews.type == "api")
        let fox = try #require(response.sources.first { $0.id == "fox-news" })
        #expect(fox.battle && fox.lean == .right)
        #expect(response.sources.first { $0.id == "allafrica" }?.provenance == .region("002"))
        #expect(response.provenanceRegistry["bbc-world"] == .country("GB"))
    }

    @Test("battles: leans, lean-tagged articles, topic tokens")
    func battles() throws {
        let response = try Fixtures.decodeAPI(BattlesResponse.self, "battles")
        #expect(response.battles.count == 4)
        let first = try #require(response.battles.first)
        #expect(first.topic == ["Supreme Court", "Supreme", "Court"])
        #expect(first.leans == [.left: 3, .center: 1, .right: 2])
        #expect(first.articles.allSatisfy { $0.lean != nil })
        #expect(first.articles.contains { $0.category == "battle" })
    }

    @Test("article extraction: structured blocks with runs and links")
    func articleBlocks() throws {
        let body = try Fixtures.decodeAPI(ArticleBody.self, "article-story-a")
        let blocks = try #require(body.blocks)
        let kinds = blocks.map { block -> String in
            switch block {
            case .paragraph: "p"
            case .heading(let level, _): "h\(level)"
            case .quote: "quote"
            case .list(let ordered, _): ordered ? "ol" : "ul"
            }
        }
        #expect(kinds == ["p", "p", "h2", "ul", "quote", "p", "h3", "p"])
        let links = blocks.flatMap { block -> [TextRun] in
            if case .paragraph(let runs) = block { return runs.filter { $0.href != nil } }
            return []
        }
        #expect(links.first?.href?.absoluteString == "https://www.bbc.com/fixture/story-b")
        #expect(!body.paragraphs.isEmpty)

        let paywall = try Fixtures.decodeAPI(ArticleBody.self, "article-story-c-paywall")
        #expect(paywall.text == "Subscribe to read this story.")
    }

    @Test("comments: page, persona of the caller, votes, timestamps")
    func comments() throws {
        let page = try Fixtures.decodeAPI(CommentsPage.self, "comments-me")
        #expect(page.total == 3 && page.comments.count == 3 && page.pageSize == 20)
        #expect(page.me?.name == "Solar Jetty")
        let voted = try #require(page.comments.first { $0.up == 2 })
        #expect(voted.createdAt.iso == "2026-09-26T12:00:30.000Z")
        #expect(try Fixtures.decodeAPI(CommentsPage.self, "comments-new").me == nil)
        let created = try Fixtures.decodeAPI(CoreModels.Comment.self, "comment-created")
        #expect((0...23).contains(created.avatar.glyph) && (0...359).contains(created.avatar.hue))
        #expect(created.mine, "the author's own comment")
        #expect(AuthorKey.isValid(created.authorKey))
        let mine = page.comments.filter(\.mine)
        #expect(mine.map(\.authorKey) == [created.authorKey], "the caller sees only their comment as mine")
        #expect(Set(page.comments.map(\.authorKey)).count == 3, "one public key per author")
        #expect(try Fixtures.decodeAPI(CommentsPage.self, "comments-new").comments.allSatisfy { !$0.mine })
    }

    @Test("moderation: a report says whether the comment is hidden; a delete confirms")
    func moderation() throws {
        #expect(try Fixtures.decodeAPI(ReportResult.self, "comment-report") == ReportResult(reported: true, hidden: false))
        #expect(try Fixtures.decodeAPI(DeleteResult.self, "comment-delete").deleted)
        #expect(ReportReason.allCases.map(\.rawValue) == ["spam", "abuse", "hate", "sexual", "violence", "other"])
        #expect(ReportReason.abuse.label == "Harassment or bullying")
    }

    @Test("reactions, votes, translation")
    func reactionsAndVotes() throws {
        let reactions = try Fixtures.decodeAPI(ReactionsResponse.self, "reactions")
        #expect(reactions.reactions.count == 12)
        #expect(reactions.reactions.values.contains { $0.myVote == .down })
        #expect(try Fixtures.decodeAPI(VoteResult.self, "news-vote-up") == VoteResult(up: 1, down: 0, myVote: .up))
        #expect(try Fixtures.decodeAPI(VoteResult.self, "news-vote-retract").myVote == nil)
        let translated = try Fixtures.decodeAPI(TranslateResponse.self, "translate-de")
        #expect(translated.translations.allSatisfy { $0.hasPrefix("[de] ") })
        #expect(try Fixtures.decodeAPI(Health.self, "health").ok)
    }

    @Test("error envelopes carry the server's codes", arguments: [
        ("summarize-501", 501, "premium-only"),
        ("article-missing-page-422", 422, "fetch-failed"),
        ("article-forbidden-403", 403, "host-not-allowed"),
        ("comment-too-fast-429", 429, "too-fast"),
        ("comment-duplicate-409", 409, "duplicate"),
        ("comment-unknown-article-404", 404, "unknown-article"),
        ("comment-bad-author-400", 400, "bad-author"),
        ("news-vote-unknown-404", 404, "unknown-article"),
        ("comment-report-own-400", 400, "own-comment"),
        ("comment-report-bad-reason-400", 400, "bad-reason"),
        ("comment-report-unknown-404", 404, "unknown-comment"),
        ("comment-delete-not-owner-403", 403, "not-owner"),
        ("comment-delete-unknown-404", 404, "unknown-comment"),
        ("comment-objectionable-422", 422, "objectionable"),
        ("comment-banned-403", 403, "banned"),
        ("unknown-endpoint-404", 404, "not-found"),
    ])
    func errors(name: String, status: Int, code: String) throws {
        let exchange = try Fixtures.api(name)
        #expect(exchange.status == status)
        let envelope = try JSONDecoder().decode(APIErrorEnvelope.self, from: exchange.body)
        #expect(envelope.error.code == code)
    }

    @Test("articles round-trip through JSON unchanged (saved-story snapshots)")
    func articleRoundTrip() throws {
        let page = try Fixtures.decodeAPI(FeedPage.self, "news-page1-author")
        let battles = try Fixtures.decodeAPI(BattlesResponse.self, "battles")
        for article in page.articles + battles.battles.flatMap(\.articles) {
            let data = try JSONEncoder().encode(article)
            let again = try JSONDecoder().decode(Article.self, from: data)
            #expect(again == article)
            #expect(again.publishedAt.iso == article.publishedAt.iso)
        }
    }

    @Test("untrusted content: bad links are dropped, http images upgraded, unknown blocks skipped")
    func untrustedContent() throws {
        let json = """
        {"articles": [
          {"id":"aaaaaaaaaaaa","title":"ok","url":"https://a.test/1","image":"http://img.test/x.jpg",
           "source":{"id":"s","name":"S"},"category":"world","publishedAt":"2026-09-26T10:00:00.000Z"},
          {"id":"bbbbbbbbbbbb","title":"evil","url":"javascript:alert(1)",
           "source":{"id":"s","name":"S"},"category":"world","publishedAt":"2026-09-26T10:00:00.000Z"},
          {"id":"cccccccccccc","title":"bad image","url":"https://a.test/3","image":"data:x",
           "source":{"id":"s","name":"S","country":"gb"},"category":"world","publishedAt":"2026-09-26T10:00:00.000Z"},
          "not an object",
          {"id":"dddddddddddd","title":"no date","url":"https://a.test/4","source":{"id":"s","name":"S"}}
        ], "total": 5, "page": 1, "pageSize": 30}
        """
        let page = try JSONDecoder().decode(FeedPage.self, from: Data(json.utf8))
        #expect(page.articles.map(\.id) == ["aaaaaaaaaaaa", "cccccccccccc"])
        #expect(page.articles[0].image?.absoluteString == "https://img.test/x.jpg")
        #expect(page.articles[0].source.provenance == .unknown, "a missing country is unknown, not international")
        #expect(page.articles[1].image == nil)
        #expect(page.articles[1].source.provenance == .international, "junk codes never reach an asset name")

        let blocks = """
        {"title":"t","text":"x","blocks":[{"type":"p","runs":[{"text":"a","href":"javascript:x"}]},
          {"type":"table","runs":[]},{"type":"ol","items":[[{"text":"one"}],[]]}]}
        """
        let body = try JSONDecoder().decode(ArticleBody.self, from: Data(blocks.utf8))
        #expect(body.blocks == [.paragraph([TextRun(text: "a")]), .list(ordered: true, items: [[TextRun(text: "one")]])])
    }
}
