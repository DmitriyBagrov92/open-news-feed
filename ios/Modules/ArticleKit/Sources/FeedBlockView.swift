import CoreModels
import DesignSystem
import SwiftUI

/// One mosaic block: a row of cards, or a poster with cards stacked beside it.
public struct FeedBlockView: View {
    let block: FeedBlock
    let columns: Int
    let width: CGFloat
    let gutter: CGFloat
    @Environment(\.cardSizing) private var sizing

    private let spacing: CGFloat = 32

    public init(block: FeedBlock, columns: Int, width: CGFloat, gutter: CGFloat) {
        self.block = block
        self.columns = columns
        self.width = width
        self.gutter = gutter
    }

    public var body: some View {
        let columnWidth = (width - gutter * 2 - spacing * CGFloat(columns - 1)) / CGFloat(max(columns, 1))
        switch block {
        case .row(let items) where columns == 1:
            VStack(spacing: 0) {
                ArticleCard(items[0])
                Divider()
            }
            .padding(.horizontal, gutter)
        case .row(let items):
            HStack(alignment: .top, spacing: spacing) {
                ForEach(items) { item in
                    cell(item).frame(width: columnWidth)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, gutter)
        case .poster(let item, _) where columns == 1:
            ArticleCard(item)
                .padding(.horizontal, gutter)
                .padding(.vertical, 14)
        case .poster(let item, let side):
            let span = item.variant == .hero ? 3 : 2
            HStack(alignment: .top, spacing: spacing) {
                ArticleCard(item, height: sizing.rowHeight * CGFloat(span) - 28)
                    .frame(width: columnWidth * 2 + spacing)
                    .padding(.vertical, 14)
                ForEach(Array(side.enumerated()), id: \.offset) { _, stack in
                    VStack(spacing: 0) {
                        ForEach(stack) { cell($0) }
                    }
                    .frame(width: columnWidth)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, gutter)
        }
    }

    private func cell(_ item: FeedItem) -> some View {
        VStack(spacing: 0) {
            ArticleCard(item, swipes: false)
            Spacer(minLength: 0)
            Divider()
        }
        .frame(height: sizing.rowHeight, alignment: .top)
        .clipped()
    }
}

