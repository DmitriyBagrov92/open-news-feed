import BattleFeature
import CoreGraphics
import CoreModels
import Foundation
import Testing

/// The arena's geometry and physics (web battle.js on Matter.js; here a small Verlet solver).
@Suite("Bubble Battle — layout and physics")
struct BattlePhysicsTests {
    /// A seeded generator: fights and kicks are reproducible.
    struct Seeded: RandomNumberGenerator {
        var state: UInt64
        mutating func next() -> UInt64 {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return state
        }
    }

    private let radii: [CGFloat] = [150, 128, 176, 140, 118, 160]
    private let leans: [Lean?] = [.left, .right, .center, .left, .right, .center]

    private func cluster(width: CGFloat = 1000) -> (BattleLayout.Cluster, BattlePhysics) {
        let layout = BattleLayout.arrange([radii], width: width).clusters[0]
        let physics = BattlePhysics(positions: layout.positions, radii: layout.radii, leans: leans,
                                    briefWidth: layout.briefWidth, clusterRadius: layout.radius)
        return (layout, physics)
    }

    @Test("the ladder: fresher and illustrated stories get bigger tiles, within the web's bounds")
    func ladder() {
        let now: Int64 = 1_790_000_000_000
        func article(ageHours: Double, image: Bool) -> Article {
            Article(id: "0123456789ab", title: "T", url: URL(string: "https://example.com")!,
                    image: image ? URL(string: "https://example.com/a.jpg") : nil,
                    source: ArticleSource(id: "s", name: "S", provenance: .unknown), category: "world",
                    publishedAt: Timestamp(milliseconds: now - Int64(ageHours * 3_600_000)), language: "en")
        }
        #expect(BattleLayout.radius(for: article(ageHours: 0, image: true), now: now, narrow: false, level: 0) == 180)
        #expect(BattleLayout.radius(for: article(ageHours: 48, image: false), now: now, narrow: false, level: 0) == 130)
        #expect(BattleLayout.radius(for: article(ageHours: 24, image: false), now: now, narrow: true, level: 0) == 118)
        #expect(BattleLayout.radius(for: article(ageHours: 0, image: true), now: now, narrow: false, level: 2) == 234)
        #expect(BattleLayout.radius(for: article(ageHours: 48, image: false), now: now, narrow: false, level: -2) == 91)
    }

    @Test("packing: no two tiles closer than their packing radii, none on the brief")
    func packing() {
        let core = BattleLayout.coreRadius(briefWidth: 340)
        let (points, radius) = BattleLayout.pack(radii, core: core)
        for i in points.indices {
            #expect(hypot(points[i].x, points[i].y) >= core + BattleLayout.packRadius(radii[i]) - 0.5, "tile \(i) on the brief")
            for k in (i + 1)..<points.count {
                let d = hypot(points[k].x - points[i].x, points[k].y - points[i].y)
                #expect(d >= BattleLayout.packRadius(radii[i]) + BattleLayout.packRadius(radii[k]) + BattleLayout.bubbleGap - 0.5)
            }
            #expect(hypot(points[i].x, points[i].y) + BattleLayout.packRadius(radii[i]) <= radius + 0.001)
        }
    }

    @Test("clusters stack down the page without overlapping, and fit the width")
    func arrange() {
        let width: CGFloat = 1100 // an iPad's arena beside the sidebar
        let (clusters, height) = BattleLayout.arrange([radii, [130, 150, 120], radii], width: width)
        #expect(clusters.count == 3)
        for (upper, lower) in zip(clusters, clusters.dropFirst()) {
            var lowest: CGFloat = 0
            for (point, r) in zip(upper.positions, upper.radii) {
                lowest = max(lowest, point.y + r + 8)
            }
            let bottom: CGFloat = upper.anchor.y + lowest
            #expect(lower.topicY >= bottom + BattleLayout.clusterGap - 0.5)
        }
        #expect(height > clusters.last!.anchor.y)
        let available: CGFloat = width / 2 - 44
        for cluster in clusters {
            let floored = cluster.radii.allSatisfy { $0 == BattleLayout.minRadius }
            for (point, r) in zip(cluster.positions, cluster.radii) {
                let reach: CGFloat = abs(point.x) + r + 8
                #expect(reach <= available + 0.5 || floored)
            }
        }
    }

    @Test("the solver settles without overlaps and falls asleep")
    func settles() {
        var (_, physics) = cluster()
        var steps = 0
        while !physics.isAsleep, steps < 2000 {
            physics.step()
            steps += 1
        }
        #expect(physics.isAsleep, "asleep after \(steps) steps")
        #expect(physics.minimumClearance > -1)
        #expect(physics.bodies.allSatisfy { hypot($0.position.x, $0.position.y) < physics.clusterRadius + 120 })
    }

    @Test("a fight between two leans, then the cluster calms down again, still overlap-free")
    func fight() {
        var (_, physics) = cluster()
        for _ in 0..<600 { physics.step() }
        var random = Seeded(state: 7)
        let pair = physics.fight(using: &random)
        let fighters = try? #require(pair)
        #expect(fighters.map { physics.bodies[$0.0].lean != physics.bodies[$0.1].lean } == true)
        #expect(!physics.isAsleep)
        var worst = CGFloat.infinity
        for _ in 0..<1500 {
            physics.step()
            worst = min(worst, physics.minimumClearance)
        }
        #expect(worst > -20, "tiles may touch hard in a fight but never pass through (\(worst))")
        #expect(physics.minimumClearance > -1)
    }

    @Test("a dragged tile follows the finger and pushes the others aside; released, it rejoins")
    func drag() {
        var (_, physics) = cluster()
        for _ in 0..<300 { physics.step() }
        let target = CGPoint(x: physics.clusterRadius + 200, y: -40)
        physics.drag(0, to: target)
        for _ in 0..<240 { physics.step() }
        let held = physics.bodies[0].position
        #expect(hypot(held.x - target.x, held.y - target.y) < 12)
        physics.drag(0, to: nil)
        for _ in 0..<1800 { physics.step() }
        let released = physics.bodies[0].position
        #expect(hypot(released.x, released.y) < hypot(target.x, target.y) - 60, "pulled back towards the cluster")
        #expect(physics.minimumClearance > -1)
    }

    @Test("the brief grows: its neighbours make room")
    func briefGrows() {
        var (_, physics) = cluster()
        for _ in 0..<600 { physics.step() }
        physics.setBriefHeight(BattleLayout.briefMaxHeight)
        for _ in 0..<1200 { physics.step() }
        #expect(physics.minimumClearance > -1)
    }

    @Test("a topic reads once: a bigram's parts are dropped, other tokens stay")
    func topic() {
        #expect(BattleTopic.title(["Supreme Court", "Supreme", "Court"]) == "Supreme Court")
        #expect(BattleTopic.title(["Ceasefire", "Cairo"]) == "Ceasefire \u{b7} Cairo")
        #expect(BattleTopic.title(["Federal Reserve", "Rates", "Federal"]) == "Federal Reserve \u{b7} Rates")
        #expect(BattleTopic.title(["Archive"]) == "Archive")
    }

    @Test("rounded squares: the separation between two tiles")
    func separation() {
        // face to face on x: inner boxes 56 apart each side → gap = 200 - 56 - 56 = 88
        #expect(BattlePhysics.gap(center: CGPoint(x: 200, y: 0), inner: 56, otherCenter: .zero,
                                  otherInner: CGSize(width: 56, height: 56), radius: 88) == 0)
        // corner to corner
        let corner = BattlePhysics.gap(center: CGPoint(x: 150, y: 150), inner: 56, otherCenter: .zero,
                                       otherInner: CGSize(width: 56, height: 56), radius: 40)
        #expect(abs(corner - (hypot(38, 38) - 40)) < 0.001)
    }
}
