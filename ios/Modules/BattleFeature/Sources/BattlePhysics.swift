import CoreGraphics
import CoreModels
import Foundation

/// The arena's geometry (web battle.js `radiusFor` / `layoutCluster` / `buildPhysics`): tile
/// sizes from the story's age, overlap-free packing around the cluster's brief, clusters stacked
/// down the page. Lengths are points; a radius is HALF of a square tile's side.
public enum BattleLayout {
    public static let topicBand: CGFloat = 44
    public static let clusterGap: CGFloat = 84
    /// The brief's expanded size is reserved up front: its growth never reflows the page.
    public static let briefFullHeight: CGFloat = 210
    public static let briefMaxHeight: CGFloat = 360
    public static let briefThinkingHeight: CGFloat = 52
    /// The invisible margin around the brief that news tiles stop at.
    public static let briefClearance: CGFloat = 24
    public static let bubbleGap: CGFloat = 12
    public static let minRadius: CGFloat = 78

    /// Squares meet at their corners: pack with a radius between the half side and the half
    /// diagonal, so relaxation can never interlock them.
    public static func packRadius(_ r: CGFloat) -> CGFloat { r * 1.18 }

    /// The card-size ladder (web `levelFactor`): −2 → 0.70 … +2 → 1.30.
    public static func sizeFactor(_ level: Int) -> CGFloat { 1 + CGFloat(level) * 0.15 }

    /// web `radiusFor`: fresher stories and stories with a photo get bigger tiles.
    public static func radius(for article: Article, now: Int64, narrow: Bool, level: Int) -> CGFloat {
        let age = Double(now - article.publishedAt.milliseconds)
        let fresh = max(0, 1 - age / (48 * 3_600_000))
        var r = 130 + fresh * 40 + (article.image == nil ? 0 : 10)
        if narrow { r *= 0.72 }
        let ladder = max(118, min(195, r.rounded()))
        return max(minRadius, (ladder * Double(sizeFactor(level))).rounded())
    }

    /// The brief's width in a container this wide.
    public static func briefWidth(_ width: CGFloat) -> CGFloat { min(340, width * 0.72) }

    /// The brief's reserved core: tiles are seeded and relaxed outside it.
    public static func coreRadius(briefWidth: CGFloat) -> CGFloat {
        hypot((briefWidth + briefClearance * 2) / 2, (briefFullHeight + briefClearance * 2) / 2) * 0.9
    }

    /// web `layoutCluster`: a golden-angle seed biased wide and low (the page reads top to bottom,
    /// vertical spread is expensive), then pairwise relaxation with clear rims, around the core.
    /// Positions are relative to the cluster's anchor; returns them and the cluster's radius.
    public static func pack(_ radii: [CGFloat], core: CGFloat) -> (positions: [CGPoint], radius: CGFloat) {
        var points = radii.enumerated().map { index, r -> CGPoint in
            let angle = Double(index) * 2.399963
            let distance = core + packRadius(r) + 6 + CGFloat(index % 3) * 26
            return CGPoint(x: cos(angle) * distance, y: sin(angle) * distance * 0.72)
        }
        for _ in 0..<80 {
            var moved = false
            for i in points.indices {
                let dc = max(hypot(points[i].x, points[i].y), 0.01)
                let minCore = core + packRadius(radii[i])
                if core > 0, dc < minCore {
                    points[i].x += points[i].x / dc * (minCore - dc)
                    points[i].y += points[i].y / dc * (minCore - dc)
                    moved = true
                }
                for k in (i + 1)..<points.count {
                    var dx = points[k].x - points[i].x
                    var dy = points[k].y - points[i].y
                    let d = max(hypot(dx, dy), 0.01)
                    let minimum = packRadius(radii[i]) + packRadius(radii[k]) + bubbleGap
                    guard d < minimum else { continue }
                    let push = (minimum - d) / 2
                    dx /= d
                    dy /= d
                    points[i].x -= dx * push
                    points[i].y -= dy * push
                    points[k].x += dx * push
                    points[k].y += dy * push
                    moved = true
                }
            }
            if !moved { break }
        }
        var radius = core
        for (point, r) in zip(points, radii) { radius = max(radius, hypot(point.x, point.y) + packRadius(r)) }
        return (points, radius)
    }

    /// One cluster placed on the page.
    public struct Cluster: Sendable, Equatable {
        /// The top of the topic line.
        public let topicY: CGFloat
        /// The center of the brief — the cluster's heart.
        public let anchor: CGPoint
        public let radius: CGFloat
        public let radii: [CGFloat]
        /// Tile centers relative to the anchor.
        public let positions: [CGPoint]
        public let briefWidth: CGFloat
    }

    /// web `buildPhysics` layout pass: every cluster gets exactly the height it needs — the topic
    /// band, the packed field (its true extents, not the bounding circle), the reserved brief —
    /// alternating a little left and right of center; a cluster wider than the page centers.
    /// Tiles shrink until the cluster fits the width.
    public static func arrange(_ clusters: [[CGFloat]], width: CGFloat) -> (clusters: [Cluster], height: CGFloat) {
        let briefW = briefWidth(width)
        let core = coreRadius(briefWidth: briefW)
        var y: CGFloat = 40
        var placed: [Cluster] = []
        for (index, original) in clusters.enumerated() {
            var radii = original
            var (positions, radius) = pack(radii, core: core)
            // shrink until it fits (the web shrinks once; a re-pack can still spill over)
            let available = width / 2 - 44
            for _ in 0..<12 {
                var xNeed: CGFloat = 0
                for (point, r) in zip(positions, radii) { xNeed = max(xNeed, abs(point.x) + r + 8) }
                guard xNeed > available, radii.contains(where: { $0 > minRadius }) else { break }
                let shrink = available / xNeed
                radii = radii.map { max(minRadius, ($0 * shrink).rounded(.down)) }
                (positions, radius) = pack(radii, core: core)
            }
            var yMin = -(briefFullHeight / 2 + briefClearance)
            var yMax = briefFullHeight / 2 + briefClearance
            var xReach = briefW / 2 + briefClearance
            for (point, r) in zip(positions, radii) {
                yMin = min(yMin, point.y - r - 8)
                yMax = max(yMax, point.y + r + 8)
                xReach = max(xReach, abs(point.x) + r + 8)
            }
            let topicY = y
            let side: CGFloat = index % 2 == 1 ? 0.12 : -0.12
            let x = xReach * 2 + 40 > width
                ? width / 2
                : max(xReach + 20, min(width - xReach - 20, width * (0.5 + side)))
            let anchor = CGPoint(x: x, y: topicY + topicBand - yMin)
            y = anchor.y + yMax + clusterGap
            placed.append(Cluster(topicY: topicY, anchor: anchor, radius: radius, radii: radii,
                                  positions: positions, briefWidth: briefW))
        }
        return (placed, y + 40)
    }
}

/// One cluster's physics (the web runs Matter.js; this is a small position-based Verlet solver):
/// rounded-square tiles that never rotate, never overlap and bounce off each other and off the
/// brief in the middle; rest-length springs to the two nearest siblings keep the group united; a
/// progressive pull holds it around its anchor; a dragged tile follows the finger; the whole
/// cluster falls asleep once it is still. One `step()` is 1/60 s; velocities are points per step.
public struct BattlePhysics: Sendable {
    public struct Body: Sendable {
        public fileprivate(set) var position: CGPoint
        fileprivate var previous: CGPoint
        public let radius: CGFloat
        fileprivate let mass: CGFloat
        public let lean: Lean?
        /// Where the finger holds it (cluster coordinates), if it is being dragged.
        public var target: CGPoint?

        /// The rounded square: an inner box plus a corner radius (web chamfer r × 0.44).
        fileprivate var corner: CGFloat { radius * 0.44 }
        fileprivate var inner: CGFloat { radius - corner }
    }

    private struct Link: Sendable {
        let a: Int
        let b: Int
        let length: CGFloat
    }

    public private(set) var bodies: [Body]
    private var links: [Link] = []
    /// The brief's collision box around the anchor, clearance included.
    public private(set) var core: CGSize
    public let clusterRadius: CGFloat
    public private(set) var isAsleep = false
    /// Rest is judged over a window, not per step: contacts and springs trade a tenth of a point
    /// back and forth forever while the cluster, to the eye, stands still.
    private var restSnapshot: [CGPoint] = []
    private var restSteps = 0
    static let restWindow = 30

    static let airFriction: CGFloat = 0.06
    static let restitution: CGFloat = 0.6
    static let maxSpeed: CGFloat = 14
    /// Tiles keep this much air between them.
    static let skin: CGFloat = 6
    /// The brief's collision box is rounded like its tile, clearance included (web chamfer 18 + 24).
    static let briefCorner: CGFloat = 18 + BattleLayout.briefClearance

    private var briefInner: CGSize {
        CGSize(width: max(0, core.width / 2 - Self.briefCorner), height: max(0, core.height / 2 - Self.briefCorner))
    }
    /// Matter's force units at 60 Hz: acceleration per step = force / mass × 16.67².
    static let stepSquared: CGFloat = (1000.0 / 60) * (1000.0 / 60)

    public init(positions: [CGPoint], radii: [CGFloat], leans: [Lean?], briefWidth: CGFloat,
                briefHeight: CGFloat = BattleLayout.briefThinkingHeight, clusterRadius: CGFloat) {
        bodies = zip(zip(positions, radii), leans).map { pair, lean in
            Body(position: pair.0, previous: pair.0, radius: pair.1, mass: pair.1 * pair.1 / 2000, lean: lean)
        }
        core = CGSize(width: briefWidth + BattleLayout.briefClearance * 2, height: briefHeight + BattleLayout.briefClearance * 2)
        self.clusterRadius = clusterRadius
        links = Self.links(bodies)
    }

    /// Springs to each tile's two nearest siblings, at a length that can never pull two tiles
    /// into each other.
    private static func links(_ bodies: [Body]) -> [Link] {
        var links: [Link] = []
        for i in bodies.indices {
            let nearest = bodies.indices
                .filter { $0 != i }
                .sorted { distance(bodies[i].position, bodies[$0].position) < distance(bodies[i].position, bodies[$1].position) }
                .prefix(2)
            for j in nearest where !links.contains(where: { ($0.a == i && $0.b == j) || ($0.a == j && $0.b == i) }) {
                links.append(Link(a: i, b: j, length: BattleLayout.packRadius(bodies[i].radius)
                                    + BattleLayout.packRadius(bodies[j].radius) + BattleLayout.bubbleGap + 6))
            }
        }
        return links
    }

    public var linkPairs: [(Int, Int)] { links.map { ($0.a, $0.b) } }

    public mutating func wake() {
        isAsleep = false
        restSnapshot = []
        restSteps = 0
    }

    /// The brief grew or shrank: the neighbours make room.
    public mutating func setBriefHeight(_ height: CGFloat) {
        let next = CGSize(width: core.width, height: height + BattleLayout.briefClearance * 2)
        guard next != core else { return }
        core = next
        wake()
    }

    public mutating func drag(_ index: Int, to target: CGPoint?) {
        guard bodies.indices.contains(index) else { return }
        bodies[index].target = target
        wake()
    }

    /// Sets a tile's velocity (points per step).
    public mutating func push(_ index: Int, _ velocity: CGVector) {
        guard bodies.indices.contains(index) else { return }
        bodies[index].previous = CGPoint(x: bodies[index].position.x - velocity.dx, y: bodies[index].position.y - velocity.dy)
        wake()
    }

    /// The page scrolled by `dy`: the tiles feel it (web: the consolidated scroll kick).
    public mutating func kick(_ dy: CGFloat, using random: inout some RandomNumberGenerator) {
        guard dy != 0 else { return }
        for index in bodies.indices {
            let ax = (CGFloat.random(in: 0..<1, using: &random) - 0.5) * abs(dy) * 4e-7 * Self.stepSquared
            let ay = -dy * 2.5e-6 * Self.stepSquared
            bodies[index].previous.x -= ax
            bodies[index].previous.y -= ay
        }
        wake()
    }

    /// Two tiles of different leans charge at each other (web `startFights`). Returns them.
    @discardableResult
    public mutating func fight(using random: inout some RandomNumberGenerator) -> (Int, Int)? {
        guard bodies.count >= 2 else { return nil }
        let a = Int.random(in: 0..<bodies.count, using: &random)
        let foes = bodies.indices.filter { $0 != a && bodies[$0].lean != bodies[a].lean }
        guard let b = foes.first ?? bodies.indices.first(where: { $0 != a }) else { return nil }
        let dx = bodies[b].position.x - bodies[a].position.x
        let dy = bodies[b].position.y - bodies[a].position.y
        let d = max(hypot(dx, dy), 1)
        let speed: CGFloat = 8.5
        push(a, CGVector(dx: dx / d * speed, dy: dy / d * speed))
        push(b, CGVector(dx: -dx / d * speed * 0.85, dy: -dy / d * speed * 0.85))
        return (a, b)
    }

    /// One 1/60 s step. Returns whether anything moved.
    @discardableResult
    public mutating func step() -> Bool {
        guard !isAsleep else { return false }
        var maxSpeed: CGFloat = 0
        for index in bodies.indices {
            var body = bodies[index]
            var vx = (body.position.x - body.previous.x) * (1 - Self.airFriction)
            var vy = (body.position.y - body.previous.y) * (1 - Self.airFriction)
            // the progressive pull to the anchor: gentle inside the cluster, firm outside it — a
            // tile in the reader's fingers follows the finger alone
            if body.target == nil {
                let dist = hypot(body.position.x, body.position.y)
                let k: CGFloat = (dist > clusterRadius + 50 ? 2e-5 : 3e-6) * Self.stepSquared
                vx -= body.position.x * k
                vy -= body.position.y * k
            }
            let speed = hypot(vx, vy)
            if speed > Self.maxSpeed {
                vx *= Self.maxSpeed / speed
                vy *= Self.maxSpeed / speed
            }
            body.previous = body.position
            body.position.x += vx
            body.position.y += vy
            // the finger: a stiff constraint (web: stiffness 0.2, tighter here — a touch, not a mouse)
            if let target = body.target {
                body.position.x += (target.x - body.position.x) * 0.35
                body.position.y += (target.y - body.position.y) * 0.35
            }
            bodies[index] = body
        }
        for link in links {
            let a = bodies[link.a].position
            let b = bodies[link.b].position
            let d = max(distance(a, b), 0.01)
            let correction = (d - link.length) * 0.004 / 2
            let nx = (b.x - a.x) / d
            let ny = (b.y - a.y) / d
            bodies[link.a].position.x += nx * correction
            bodies[link.a].position.y += ny * correction
            bodies[link.b].position.x -= nx * correction
            bodies[link.b].position.y -= ny * correction
        }
        for _ in 0..<8 { resolveCollisions() }
        for body in bodies {
            maxSpeed = max(maxSpeed, distance(body.position, body.previous))
        }
        restSteps += 1
        if restSteps >= Self.restWindow {
            let held = bodies.contains { $0.target != nil }
            if !held, restSnapshot.count == bodies.count,
               zip(bodies, restSnapshot).allSatisfy({ distance($0.position, $1) < 0.5 }) {
                isAsleep = true
            }
            restSnapshot = bodies.map(\.position)
            restSteps = 0
        }
        return maxSpeed >= 0.01
    }

    private mutating func resolveCollisions() {
        for i in bodies.indices {
            // the brief: static, tiles stop at its clearance rim
            if let (normal, depth) = Self.separation(center: bodies[i].position, inner: bodies[i].inner,
                                                      otherCenter: .zero, otherInner: briefInner,
                                                      radius: bodies[i].corner + Self.briefCorner) {
                bodies[i].position.x += normal.dx * depth
                bodies[i].position.y += normal.dy * depth
                bounce(i, off: normal)
            }
            for k in (i + 1)..<bodies.count {
                guard let (normal, depth) = Self.separation(center: bodies[k].position, inner: bodies[k].inner,
                                                            otherCenter: bodies[i].position,
                                                            otherInner: CGSize(width: bodies[i].inner, height: bodies[i].inner),
                                                            radius: bodies[k].corner + bodies[i].corner + Self.skin)
                else { continue }
                let wi = bodies[i].target == nil ? 1 / bodies[i].mass : 0.1 / bodies[i].mass
                let wk = bodies[k].target == nil ? 1 / bodies[k].mass : 0.1 / bodies[k].mass
                let share = wk / (wi + wk)
                bodies[k].position.x += normal.dx * depth * share
                bodies[k].position.y += normal.dy * depth * share
                bodies[i].position.x -= normal.dx * depth * (1 - share)
                bodies[i].position.y -= normal.dy * depth * (1 - share)
                bounce(i, k, along: normal)
            }
        }
    }

    /// How far and which way a rounded square (inner half-size `inner` around `center`) must move
    /// to clear another rounded box (inner half-extents `otherInner` around `otherCenter`), their
    /// corner radii summing to `radius`. Nil when they are clear.
    static func separation(center: CGPoint, inner: CGFloat, otherCenter: CGPoint, otherInner: CGSize,
                           radius: CGFloat) -> (CGVector, CGFloat)? {
        // the gap between the two inner boxes on each axis (negative: they overlap on that axis)
        let dx = center.x - otherCenter.x
        let dy = center.y - otherCenter.y
        let gapX = abs(dx) - inner - max(0, otherInner.width)
        let gapY = abs(dy) - inner - max(0, otherInner.height)
        if gapX > 0, gapY > 0 {
            // corner to corner
            let d = hypot(gapX, gapY)
            guard d < radius else { return nil }
            return (CGVector(dx: (dx < 0 ? -gapX : gapX) / d, dy: (dy < 0 ? -gapY : gapY) / d), radius - d)
        }
        if gapX >= gapY {
            guard gapX < radius else { return nil }
            return (CGVector(dx: dx < 0 ? -1 : 1, dy: 0), radius - gapX)
        }
        guard gapY < radius else { return nil }
        return (CGVector(dx: 0, dy: dy < 0 ? -1 : 1), radius - gapY)
    }

    /// Bounces only a real impact: a tile resting against another under the anchor's pull must
    /// not rebound every step (it would never settle).
    private static func elasticity(_ vn: CGFloat) -> CGFloat { -vn > 1 ? restitution : 0 }

    /// Reflects a tile's velocity off a static surface.
    private mutating func bounce(_ i: Int, off normal: CGVector) {
        let vx = bodies[i].position.x - bodies[i].previous.x
        let vy = bodies[i].position.y - bodies[i].previous.y
        let vn = vx * normal.dx + vy * normal.dy
        guard vn < 0 else { return }
        let j = -(1 + Self.elasticity(vn)) * vn
        bodies[i].previous.x -= normal.dx * j
        bodies[i].previous.y -= normal.dy * j
    }

    /// An elastic-ish exchange between two tiles along the contact normal (from i towards k).
    private mutating func bounce(_ i: Int, _ k: Int, along normal: CGVector) {
        let vix = bodies[i].position.x - bodies[i].previous.x
        let viy = bodies[i].position.y - bodies[i].previous.y
        let vkx = bodies[k].position.x - bodies[k].previous.x
        let vky = bodies[k].position.y - bodies[k].previous.y
        let vn = (vkx - vix) * normal.dx + (vky - viy) * normal.dy
        guard vn < 0 else { return }
        let invI = 1 / bodies[i].mass
        let invK = 1 / bodies[k].mass
        let j = -(1 + Self.elasticity(vn)) * vn / (invI + invK)
        bodies[i].previous.x += normal.dx * j * invI
        bodies[i].previous.y += normal.dy * j * invI
        bodies[k].previous.x -= normal.dx * j * invK
        bodies[k].previous.y -= normal.dy * j * invK
    }

    /// The smallest clearance between any two tiles and between a tile and the brief (negative:
    /// an overlap). For tests and diagnostics.
    public var minimumClearance: CGFloat {
        var clearance = CGFloat.infinity
        for i in bodies.indices {
            let briefGap = Self.gap(center: bodies[i].position, inner: bodies[i].inner, otherCenter: .zero,
                                    otherInner: briefInner, radius: bodies[i].corner + Self.briefCorner)
            clearance = min(clearance, briefGap)
            for k in (i + 1)..<bodies.count {
                clearance = min(clearance, Self.gap(center: bodies[k].position, inner: bodies[k].inner,
                                                    otherCenter: bodies[i].position,
                                                    otherInner: CGSize(width: bodies[i].inner, height: bodies[i].inner),
                                                    radius: bodies[k].corner + bodies[i].corner))
            }
        }
        return clearance
    }

    /// The clearance between a rounded square and a rounded box (negative: they overlap).
    public static func gap(center: CGPoint, inner: CGFloat, otherCenter: CGPoint, otherInner: CGSize, radius: CGFloat) -> CGFloat {
        let gapX = abs(center.x - otherCenter.x) - inner - max(0, otherInner.width)
        let gapY = abs(center.y - otherCenter.y) - inner - max(0, otherInner.height)
        if gapX > 0, gapY > 0 { return hypot(gapX, gapY) - radius }
        return max(gapX, gapY) - radius
    }
}

private func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
    hypot(a.x - b.x, a.y - b.y)
}
