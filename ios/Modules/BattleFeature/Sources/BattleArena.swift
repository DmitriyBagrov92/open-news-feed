import ArticleKit
import CoreModels
import DesignSystem
import Observation
import QuartzCore
import SwiftUI

/// The arena on a wide window (web battle.js physics mode): each story's coverage packed around
/// its HOW COVERAGE DIFFERS brief; the tiles are bodies — hold one to drag it, the others make
/// room; every few seconds two opposing viewpoints charge at each other; scrolling nudges them.
struct BattleArena: View {
    let store: BattleStore
    @State private var arena = ArenaModel()
    @Environment(\.cardSizing) private var sizing
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.clockNow) private var now
    @Environment(\.openStory) private var openStory

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    BattleLegend(updatedAt: store.updatedAt, showsHint: true)
                        .padding(.horizontal, 24)
                        .padding(.top, 6)
                    ZStack(alignment: .topLeading) {
                        LinksLayer(arena: arena)
                        ForEach(arena.clusters) { cluster in
                            ArenaClusterView(cluster: cluster, brief: store.briefs[cluster.id], arena: arena) { article in
                                openStory?(article, in: cluster.battle.articles)
                            }
                        }
                    }
                    .frame(width: width, height: arena.height, alignment: .topLeading)
                    .coordinateSpace(.named(ArenaModel.space))
                }
            }
            .onScrollGeometryChange(for: CGRect.self) { geometry in
                CGRect(origin: geometry.contentOffset, size: geometry.containerSize)
            } action: { old, new in
                arena.scrolled(from: old, to: new)
            }
            .task(id: ArenaKey(battles: store.battles.map(\.id), width: width, level: sizing.level)) {
                arena.build(store.battles, width: width, level: sizing.level, now: now)
            }
        }
        .onAppear {
            arena.onVisibility = { [weak store] id, visible in store?.clusterVisible(id, visible) }
            arena.start()
        }
        .onDisappear { arena.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { arena.start() } else { arena.stop() }
        }
        .accessibilityIdentifier("battle-arena")
    }

    struct ArenaKey: Hashable {
        let battles: [String]
        let width: CGFloat
        let level: Int
    }
}

/// One cluster: its topic, its brief at the heart, its tiles where the physics puts them.
private struct ArenaClusterView: View {
    let cluster: ArenaCluster
    let brief: BattleStore.Brief?
    let arena: ArenaModel
    let open: (Article) -> Void

    var body: some View {
        Text(BattleTopic.title(cluster.battle.topic))
            .heavyTitle(20, relativeTo: .title3)
            .frame(width: 600)
            .position(x: cluster.layout.anchor.x, y: cluster.layout.topicY + 14)
            .accessibilityAddTraits(.isHeader)
        BattleBriefCard(brief: brief)
            .frame(width: cluster.layout.briefWidth)
            .fixedSize(horizontal: false, vertical: true)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                arena.setBriefHeight(cluster.id, min(BattleLayout.briefMaxHeight, height))
            }
            .position(cluster.layout.anchor)
        ForEach(cluster.bubbles) { bubble in
            ArenaBubbleView(bubble: bubble, cluster: cluster, arena: arena, open: open)
        }
    }
}

/// A tile, placed by the physics; tap to read, hold and drag to move.
private struct ArenaBubbleView: View {
    let bubble: ArenaBubble
    let cluster: ArenaCluster
    let arena: ArenaModel
    let open: (Article) -> Void

    var body: some View {
        BubbleTile(article: bubble.article, side: bubble.radius * 2, isFighting: bubble.isFighting)
            .position(x: cluster.layout.anchor.x + bubble.position.x, y: cluster.layout.anchor.y + bubble.position.y)
            .onTapGesture { open(bubble.article) }
            .gesture(
                LongPressGesture(minimumDuration: 0.12)
                    .sequenced(before: DragGesture(minimumDistance: 0, coordinateSpace: .named(ArenaModel.space)))
                    .onChanged { value in
                        if case .second(true, let drag?) = value {
                            arena.drag(bubble, in: cluster, to: drag.location)
                        }
                    }
                    .onEnded { _ in arena.release(bubble, in: cluster) }
            )
            .accessibilityAction { open(bubble.article) }
    }
}

/// The halo that unites each cluster and the springs between its tiles (web `drawLinks`).
private struct LinksLayer: View {
    let arena: ArenaModel

    var body: some View {
        let frame = arena.frame // redraw when the bodies move
        let snapshot = arena.linkSnapshot()
        Canvas { context, _ in
            _ = frame
            for cluster in snapshot {
                let halo = Path(ellipseIn: CGRect(x: cluster.anchor.x - cluster.radius - 40, y: cluster.anchor.y - cluster.radius - 40,
                                                  width: (cluster.radius + 40) * 2, height: (cluster.radius + 40) * 2))
                context.fill(halo, with: .radialGradient(
                    Gradient(colors: [Color.gray.opacity(0.07), Color.gray.opacity(0)]),
                    center: cluster.anchor, startRadius: cluster.radius * 0.3, endRadius: cluster.radius + 40))
                var lines = Path()
                for (a, b) in cluster.lines {
                    lines.move(to: a)
                    lines.addLine(to: b)
                }
                context.stroke(lines, with: .color(.gray.opacity(0.28)), lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Model

@MainActor
@Observable
final class ArenaBubble: Identifiable {
    let id: String
    let article: Article
    let index: Int
    let radius: CGFloat
    var position: CGPoint
    var isFighting = false

    init(article: Article, index: Int, radius: CGFloat, position: CGPoint) {
        id = article.id
        self.article = article
        self.index = index
        self.radius = radius
        self.position = position
    }
}

@MainActor
@Observable
final class ArenaCluster: Identifiable {
    let id: String
    let battle: Battle
    let layout: BattleLayout.Cluster
    let bubbles: [ArenaBubble]
    @ObservationIgnored var physics: BattlePhysics
    /// Near the viewport: simulated (web `updateMounts`).
    @ObservationIgnored var isMounted = false
    @ObservationIgnored var isVisible = false

    init(battle: Battle, layout: BattleLayout.Cluster) {
        id = battle.id
        self.battle = battle
        self.layout = layout
        bubbles = battle.articles.enumerated().map { index, article in
            ArenaBubble(article: article, index: index, radius: layout.radii[index], position: layout.positions[index])
        }
        physics = BattlePhysics(positions: layout.positions, radii: layout.radii, leans: battle.articles.map(\.lean),
                                briefWidth: layout.briefWidth, clusterRadius: layout.radius)
    }
}

/// The arena's clock: steps the mounted, awake clusters at 60 Hz and publishes their positions;
/// asleep, it stops asking for frames.
@MainActor
@Observable
final class ArenaModel {
    static let space = "battle-arena"

    private(set) var clusters: [ArenaCluster] = []
    private(set) var height: CGFloat = 0
    /// Bumped whenever a tile moved: the links layer redraws.
    private(set) var frame = 0

    @ObservationIgnored var onVisibility: (@MainActor (String, Bool) -> Void)?
    @ObservationIgnored private var driver: FrameDriver?
    @ObservationIgnored private var lastTime: CFTimeInterval = 0
    @ObservationIgnored private var accumulator: CFTimeInterval = 0
    @ObservationIgnored private var viewport = CGRect.zero
    @ObservationIgnored private var fightTask: Task<Void, Never>?
    @ObservationIgnored private var random = SystemRandomNumberGenerator()
    @ObservationIgnored private var running = false

    /// web `FIGHT_EVERY_MS`.
    static let fightEvery: Duration = .milliseconds(4500)

    func build(_ battles: [Battle], width: CGFloat, level: Int, now: Int64) {
        guard width > 0 else { return }
        let narrow = width < 640
        let radii = battles.map { battle in
            battle.articles.map { BattleLayout.radius(for: $0, now: now, narrow: narrow, level: level) }
        }
        let (layouts, total) = BattleLayout.arrange(radii, width: width)
        clusters = zip(battles, layouts).map { ArenaCluster(battle: $0, layout: $1) }
        height = total
        updateMounts()
        wake()
    }

    func start() {
        guard !running else { return }
        running = true
        if driver == nil {
            driver = FrameDriver { [weak self] time in self?.tick(time) }
        }
        wake()
        fightTask?.cancel()
        fightTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.fightEvery)
                guard !Task.isCancelled else { return }
                self?.fight()
            }
        }
    }

    func stop() {
        running = false
        driver?.stop()
        fightTask?.cancel()
        fightTask = nil
    }

    private func wake() {
        guard running else { return }
        lastTime = 0
        driver?.start()
    }

    // MARK: Frames

    private func tick(_ time: CFTimeInterval) {
        let dt = lastTime == 0 ? 1.0 / 60 : min(time - lastTime, 1.0 / 20)
        lastTime = time
        accumulator += dt
        var steps = 0
        while accumulator >= 1.0 / 60, steps < 3 {
            accumulator -= 1.0 / 60
            steps += 1
            for cluster in clusters where cluster.isMounted { cluster.physics.step() }
        }
        if steps == 3 { accumulator = 0 }
        var moved = false
        var awake = false
        for cluster in clusters where cluster.isMounted {
            if !cluster.physics.isAsleep { awake = true }
            for bubble in cluster.bubbles {
                let position = cluster.physics.bodies[bubble.index].position
                if abs(position.x - bubble.position.x) > 0.05 || abs(position.y - bubble.position.y) > 0.05 {
                    bubble.position = position
                    moved = true
                }
            }
        }
        if moved { frame &+= 1 }
        if !awake { driver?.stop() } // a settled arena costs nothing
    }

    // MARK: Interaction

    func drag(_ bubble: ArenaBubble, in cluster: ArenaCluster, to location: CGPoint) {
        cluster.physics.drag(bubble.index, to: CGPoint(x: location.x - cluster.layout.anchor.x, y: location.y - cluster.layout.anchor.y))
        wake()
    }

    func release(_ bubble: ArenaBubble, in cluster: ArenaCluster) {
        cluster.physics.drag(bubble.index, to: nil)
        wake()
    }

    func setBriefHeight(_ id: String, _ height: CGFloat) {
        guard let cluster = clusters.first(where: { $0.id == id }) else { return }
        cluster.physics.setBriefHeight(height)
        wake()
    }

    /// The page scrolled: mount the clusters near the viewport, report the ones in view, nudge them.
    func scrolled(from old: CGRect, to new: CGRect) {
        viewport = new
        updateMounts()
        let dy = max(-300, min(300, new.minY - old.minY))
        guard dy != 0, abs(dy) < 400 else { return }
        for cluster in clusters where cluster.isMounted { cluster.physics.kick(dy, using: &random) }
        wake()
    }

    private func updateMounts() {
        let screen = max(viewport.height, 600)
        for cluster in clusters {
            let y = cluster.layout.anchor.y
            let mounted = y > viewport.minY - screen * 2 && y < viewport.maxY + screen * 2
            if mounted, !cluster.isMounted { cluster.physics.wake() }
            cluster.isMounted = mounted
            // in view: its topic or its brief band (web: both count, 60 px margin)
            let top = cluster.layout.topicY - 60
            let bottom = cluster.layout.anchor.y + BattleLayout.briefFullHeight / 2 + 60
            let visible = bottom > viewport.minY && top < viewport.maxY && viewport.height > 0
            if visible != cluster.isVisible {
                cluster.isVisible = visible
                onVisibility?(cluster.id, visible)
            }
        }
    }

    /// web `startFights`: two opposing viewpoints of a cluster in view charge at each other.
    private func fight() {
        let candidates = clusters.filter { $0.isVisible && $0.isMounted && $0.bubbles.count >= 2 }
        guard let cluster = candidates.randomElement(using: &random),
              let pair = cluster.physics.fight(using: &random) else { return }
        let (a, b) = pair
        let fighters = [cluster.bubbles[a], cluster.bubbles[b]]
        fighters.forEach { $0.isFighting = true }
        wake()
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(1300))
            guard self != nil else { return }
            fighters.forEach { $0.isFighting = false }
        }
    }

    // MARK: Drawing

    struct LinkCluster {
        let anchor: CGPoint
        let radius: CGFloat
        let lines: [(CGPoint, CGPoint)]
    }

    /// The mounted clusters' halos and springs in arena coordinates.
    func linkSnapshot() -> [LinkCluster] {
        clusters.filter(\.isMounted).map { cluster in
            let anchor = cluster.layout.anchor
            let points = cluster.bubbles.map { CGPoint(x: anchor.x + $0.position.x, y: anchor.y + $0.position.y) }
            return LinkCluster(anchor: anchor, radius: cluster.layout.radius,
                               lines: cluster.physics.linkPairs.map { (points[$0.0], points[$0.1]) })
        }
    }
}

/// A display link on the main run loop (common modes: it keeps ticking while the page scrolls).
@MainActor
private final class FrameDriver: NSObject {
    private var link: CADisplayLink?
    private let onFrame: @MainActor (CFTimeInterval) -> Void

    init(onFrame: @escaping @MainActor (CFTimeInterval) -> Void) {
        self.onFrame = onFrame
    }

    func start() {
        guard link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(step(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func step(_ link: CADisplayLink) {
        onFrame(link.targetTimestamp)
    }
}
