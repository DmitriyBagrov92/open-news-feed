import ArticleKit
import CoreModels
import DesignSystem
import Networking
import SwiftUI

/// The conversation at the end of a story (web `.cmt-panel`): the count and New / Top, the
/// composer (a sheet, with the community rules the first time), the comments with votes and each
/// comment's menu — report with a reason, block the commenter, delete your own.
struct CommentsSection: View {
    let store: CommentsStore
    @State private var composing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            composer
            content
        }
        .padding(.top, 20)
        // loads when the reader gets near it: /api/comments shares a 30/min budget with extraction
        .onScrollVisibilityChange(threshold: 0.01) { visible in
            if visible { Task { await store.loadIfNeeded() } }
        }
        .sheet(isPresented: $composing) {
            ComposerSheet(store: store)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("comments")
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(L10n.t("comments.title")).captionVoice(.primary)
            if store.total > 0 {
                Text("\(store.total)").captionVoice(.secondary).accessibilityIdentifier("comments-total")
            }
            Spacer(minLength: 8)
            Picker(L10n.t("ios.comments.open"), selection: Binding(
                get: { store.sort },
                set: { next in Task { await store.setSort(next) } }
            )) {
                ForEach(CommentsStore.Sort.allCases) { sort in
                    Text(sort.label).tag(sort)
                }
            }
            .pickerStyle(.segmented)
            .fixedSize()
            .accessibilityIdentifier("comments-sort")
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                composing = true
            } label: {
                HStack(spacing: 10) {
                    Text(store.draft.isEmpty ? L10n.t("ios.comments.write") : store.draft)
                        .lineLimit(1)
                        .foregroundStyle(store.draft.isEmpty ? .secondary : .primary)
                    Spacer(minLength: 0)
                    Image(systemName: "square.and.pencil").foregroundStyle(.tint)
                }
                .font(.body)
                .padding(.horizontal, 14)
                .frame(minHeight: 46)
                .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.t("comments.placeholder"))
            .accessibilityIdentifier("comments-compose")
            if let me = store.me {
                Text(L10n.t("comments.as", ["name": me.name])).captionVoice(.secondary)
            }
            RulesLink()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch store.phase {
        case .idle,
             .loading where store.comments.isEmpty:
            VStack(spacing: 12) {
                ForEach(0..<2, id: \.self) { _ in CommentSkeleton() }
            }
        case .empty where store.comments.isEmpty:
            Text(L10n.t("comments.empty"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("comments-empty")
        case .failed:
            HStack(spacing: 10) {
                Text(L10n.t("comments.error")).font(.subheadline).foregroundStyle(.secondary)
                Button(L10n.t("comments.retry")) { Task { await store.reload() } }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        default:
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(store.comments) { comment in
                    CommentRow(comment: comment, store: store)
                }
                if store.hasMore {
                    Button(L10n.t("comments.loadMore")) { Task { await store.loadMore() } }
                        .buttonStyle(.bordered)
                        .disabled(store.isLoading)
                        .accessibilityIdentifier("comments-more")
                }
            }
        }
    }
}

/// "By posting you accept the community rules" → /terms in the in-app browser.
struct RulesLink: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            openURL(MeridianLinks.terms)
        } label: {
            Text(L10n.t("comments.rules"))
                .font(.caption2)
                .underline()
                .foregroundStyle(.secondary)
                .frame(minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .padding(.vertical, -14) // a 44 pt target, the line's own height in the layout
        .accessibilityIdentifier("comments-rules")
    }
}

struct CommentRow: View {
    let comment: CoreModels.Comment
    let store: CommentsStore
    @Environment(\.clockNow) private var now

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                PersonaAvatar(hue: comment.avatar.hue, glyph: comment.avatar.glyph)
                Text(comment.name).font(.subheadline.weight(.bold)).lineLimit(1)
                Text(RelativeTime.relTime(comment.createdAt, now: now)).captionVoice(.secondary)
                Spacer(minLength: 0)
                Menu {
                    CommentMenu(comment: comment, store: store)
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 36, height: 32)
                        .contentShape(Rectangle())
                }
                .accessibilityLabel(L10n.t("comments.actions"))
                .accessibilityIdentifier("comment-\(comment.id)-menu")
            }
            Text(comment.body)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(.leading, 44)
                .accessibilityIdentifier("comment-\(comment.id)-body")
            HStack(spacing: 6) {
                vote(.up, count: comment.up)
                vote(.down, count: comment.down)
            }
            .padding(.leading, 44)
        }
        .padding(.bottom, 12)
        .overlay(alignment: .bottom) {
            Rectangle().fill(.separator).frame(height: 0.5).padding(.leading, 44)
        }
        .contextMenu { CommentMenu(comment: comment, store: store) }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("comment-\(comment.id)")
    }

    private func vote(_ vote: Vote, count: Int) -> some View {
        let pressed = comment.myVote == vote
        return Button {
            Task { await store.vote(comment, vote) }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: vote == .up ? "arrow.up" : "arrow.down").imageScale(.small)
                Text("\(count)").monospacedDigit()
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(pressed ? Color.accentColor : Color.secondary)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(pressed ? AnyShapeStyle(Color.accentColor.opacity(0.14)) : AnyShapeStyle(.fill.tertiary), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.t(vote == .up ? "comments.like" : "comments.dislike"))
        .accessibilityValue(String(count))
        .accessibilityAddTraits(pressed ? .isSelected : [])
        .accessibilityIdentifier("comment-\(comment.id)-\(vote == .up ? "up" : "down")")
        .sensoryFeedback(.selection, trigger: pressed)
    }
}

/// Delete for your own comment; Report (with a reason) and Block for everyone else's.
struct CommentMenu: View {
    let comment: CoreModels.Comment
    let store: CommentsStore

    var body: some View {
        if comment.mine {
            Button(L10n.t("comments.delete"), systemImage: "trash", role: .destructive) {
                Task { await store.delete(comment) }
            }
        } else {
            Menu(L10n.t("comments.report"), systemImage: "flag") {
                ForEach(ReportReason.allCases) { reason in
                    Button(reason.label) {
                        Task { await store.report(comment, reason: reason) }
                    }
                }
            }
            if !comment.authorKey.isEmpty {
                Button(L10n.t("comments.block", ["name": comment.name]), systemImage: "hand.raised", role: .destructive) {
                    store.block(comment)
                }
            }
        }
    }
}

struct CommentSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Circle().fill(.fill.tertiary).frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 8) {
                Capsule().fill(.fill.tertiary).frame(width: 120, height: 11)
                Capsule().fill(.fill.tertiary).frame(height: 11)
                Capsule().fill(.fill.tertiary).frame(width: 180, height: 11)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Composer

/// The composer sheet. The first time, it opens on the community rules (App Store Guideline 1.2:
/// the reader agrees to terms that do not tolerate objectionable content before posting).
struct ComposerSheet: View {
    @Bindable var store: CommentsStore
    @Environment(\.dismiss) private var dismiss
    @State private var showsRules: Bool
    @FocusState private var focused: Bool

    init(store: CommentsStore) {
        self.store = store
        _showsRules = State(initialValue: store.needsRulesAcceptance)
    }

    var body: some View {
        NavigationStack {
            Group {
                if showsRules {
                    CommunityRules {
                        store.acceptRules()
                        withAnimation(.snappy) { showsRules = false }
                    }
                } else {
                    editor
                }
            }
            .navigationTitle(L10n.t(showsRules ? "ios.rules.title" : "ios.comments.open"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.t("ios.comments.cancel")) { dismiss() }
                        .accessibilityIdentifier("comments-cancel")
                }
                if !showsRules {
                    ToolbarItem(placement: .confirmationAction) {
                        Button {
                            Task { if await store.post() { dismiss() } }
                        } label: {
                            if store.isPosting {
                                ProgressView()
                            } else {
                                Text(L10n.t("comments.post"))
                            }
                        }
                        .disabled(!store.canPost)
                        .accessibilityLabel(L10n.t(store.isPosting ? "comments.posting" : "comments.post"))
                        .accessibilityIdentifier("comments-post")
                    }
                }
            }
        }
        // a refusal ("breaks the community rules") must show above the sheet, not under it
        .overlay(alignment: .bottom) { ToastOverlay().padding(.bottom, 12) }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack(alignment: .topLeading) {
                if store.draft.isEmpty {
                    Text(L10n.t("comments.placeholder"))
                        .foregroundStyle(.tertiary)
                        .padding(.top, 8)
                        .padding(.leading, 5)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $store.draft)
                    .focused($focused)
                    .scrollContentBackground(.hidden)
                    .accessibilityLabel(L10n.t("comments.placeholder"))
                    .accessibilityIdentifier("comments-input")
            }
            .font(.body)
            .frame(minHeight: 120)
            HStack(spacing: 8) {
                if let me = store.me {
                    PersonaAvatar(hue: me.avatar.hue, glyph: me.avatar.glyph, size: 22)
                    Text(L10n.t("comments.as", ["name": me.name])).captionVoice(.secondary)
                }
                Spacer(minLength: 0)
                let used = store.draft.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
                Text(L10n.t("ios.comments.count", ["n": String(used)]))
                    .captionVoice(used > CommentsStore.bodyLimits.upperBound ? Color.red : Color.secondary)
            }
            RulesLink()
        }
        .padding(20)
        .onAppear { focused = true }
    }
}

/// The community rules, agreed to once before the first comment (the full text is /terms).
struct CommunityRules: View {
    let agree: () -> Void
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(L10n.t("ios.rules.lead")).font(.body.weight(.medium))
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(["hate", "harassment", "sexual", "spam", "illegal", "impersonation"], id: \.self) { key in
                        HStack(alignment: .firstTextBaseline, spacing: 9) {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(.red).imageScale(.small)
                            Text(L10n.t("ios.rules.\(key)"))
                        }
                    }
                }
                .font(.subheadline)
                Text(L10n.t("ios.rules.moderation")).font(.subheadline).foregroundStyle(.secondary)
                Button(L10n.t("ios.rules.full")) { openURL(MeridianLinks.terms) }
                    .font(.subheadline)
            }
            .padding(20)
        }
        .accessibilityIdentifier("rules")
        // pinned: visible at the sheet's medium height too
        .safeAreaBar(edge: .bottom) {
            Button(action: agree) {
                Text(L10n.t("ios.rules.agree")).frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
            .accessibilityIdentifier("rules-agree")
        }
    }
}
