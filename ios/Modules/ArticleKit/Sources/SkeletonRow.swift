import DesignSystem
import SwiftUI

/// A row-shaped placeholder while a page loads (web `skeletonCard`).
public struct SkeletonRow: View {
    @Environment(\.cardSizing) private var sizing
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    public init() {}

    public var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 4).frame(width: 110, height: 10)
                RoundedRectangle(cornerRadius: 4).frame(height: 14)
                RoundedRectangle(cornerRadius: 4).frame(height: 14)
                RoundedRectangle(cornerRadius: 4).frame(width: 180, height: 14)
            }
            RoundedRectangle(cornerRadius: Tokens.Radius.thumb, style: .continuous)
                .frame(width: sizing.thumb, height: sizing.thumb)
        }
        .foregroundStyle(.quaternary)
        .opacity(dim ? 0.45 : 1)
        .padding(.vertical, Tokens.Space.row)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) { dim = true }
        }
        .accessibilityHidden(true)
    }
}
