import ArticleKit
import CoreModels
import StoryFeature
import SwiftUI

/// One tab's navigation. On compact width a story is pushed, zooming out of its card; on regular
/// width it opens in the pane beside the feed (web: a full-screen layer on phones, a pane from
/// 860 px). Everything inside gets the `openStory` action.
struct StoryStack<Root: View>: View {
    let tab: AppTab
    let router: AppRouter
    let root: Root
    @Namespace private var zoom
    @Environment(\.horizontalSizeClass) private var sizeClass

    init(_ tab: AppTab, router: AppRouter, @ViewBuilder root: () -> Root) {
        self.tab = tab
        self.router = router
        self.root = root()
    }

    var body: some View {
        let (tab, router) = (tab, router)
        let regular = sizeClass == .regular
        NavigationStack(path: Binding(get: { router.paths[tab] ?? [] }, set: { router.paths[tab] = $0 })) {
            root
                .navigationDestination(for: StoryRoute.self) { route in
                    StoryPager(route: route, presentation: .push)
                        .navigationTransition(.zoom(sourceID: route.articleID, in: zoom))
                }
        }
        .environment(\.storyZoomNamespace, regular ? nil : zoom)
        .environment(\.openStory, OpenStoryAction(id: [AnyHashable(tab), AnyHashable(regular)]) { article, context in
            router.open(StoryRoute(article: article, context: context), on: tab, regular: regular)
        })
        .inspector(isPresented: Binding(
            get: { regular && router.panes[tab] != nil },
            set: { if !$0 { router.panes[tab] = nil } }
        )) {
            if let route = router.panes[tab] {
                NavigationStack {
                    StoryPager(route: route, presentation: .pane(close: { router.panes[tab] = nil }))
                }
                .id(route.id)
                .inspectorColumnWidth(min: 360, ideal: 460, max: 640)
            }
        }
    }
}
