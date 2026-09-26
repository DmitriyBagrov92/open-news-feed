import CoreModels
import Foundation
import Intelligence
import Testing

/// The Bubble Battle contrast analysis, replayed against vectors exported from battle-brief.js.
@Suite("battle-brief.js — golden parity")
struct BattleBriefGoldenTests {
    struct Vectors: Decodable {
        struct Stance: Decodable {
            let titles: [String]
            let score: Int
            let evidence: String?
        }
        struct Row: Decodable {
            let lean: String
            let source: String
            let stance: String
            let evidence: String?
        }
        struct Cluster: Decodable {
            let id: String
            let rows: [Row]
        }
        let stance: [Stance]
        let rows: [Cluster]
    }

    struct Captured: Decodable {
        let body: BattlesResponse
    }

    @Test("stanceOf: hostile vs approving lexicons, ASCII word boundaries, the strongest receipt")
    func stance() throws {
        let vectors = try Fixtures.golden(Vectors.self, "battle")
        for vector in vectors.stance {
            let (score, evidence) = BattleBrief.stance(of: vector.titles)
            #expect(score == vector.score, "\(vector.titles)")
            #expect(evidence == vector.evidence, "\(vector.titles)")
        }
    }

    @Test("contrastRows: one row per lean, left → center → right, two outlets, stance and receipt")
    func rows() throws {
        let vectors = try Fixtures.golden(Vectors.self, "battle")
        let battles = try JSONDecoder().decode(Captured.self, from: Fixtures.data("api/battles.json")).body.battles
        for cluster in vectors.rows {
            let battle = try #require(battles.first { $0.id == cluster.id })
            let rows = BattleBrief.contrastRows(battle)
            #expect(rows.map(\.lean.rawValue) == cluster.rows.map(\.lean), "\(cluster.id)")
            #expect(rows.map(\.source) == cluster.rows.map(\.source), "\(cluster.id)")
            #expect(rows.map(\.stance.rawValue) == cluster.rows.map(\.stance), "\(cluster.id)")
            #expect(rows.map(\.evidence) == cluster.rows.map(\.evidence), "\(cluster.id)")
        }
    }
}
