import ArticleKit
import CoreModels
import Dependencies
import DesignSystem
import Networking
import Persistence
import SwiftUI

/// Settings (web: the settings sheet, index.html:390-455): appearance and card size, THE language
/// and auto-translation, Ahead, the sources, the commenters you blocked, the community rules and
/// the legal pages, and — an app addition — a fresh anonymous identity. The glass slider is gone:
/// Liquid Glass follows the system's own setting.
public struct SettingsView: View {
    private let forecastAvailable: Bool
    @Environment(PreferencesStore.self) private var preferences
    @Environment(SourcesModel.self) private var sources
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Dependency(\.authorIdentity) private var identity
    @State private var confirmsReset = false
    /// The sheet sits above the toasts: the reset confirms itself in place.
    @State private var didReset = false

    /// - Parameter forecastAvailable: Apple Intelligence exists here (the Ahead row does not otherwise).
    public init(forecastAvailable: Bool) {
        self.forecastAvailable = forecastAvailable
    }

    public var body: some View {
        NavigationStack {
            Form {
                appearanceSection
                languageSection
                if forecastAvailable { forecastSection }
                sourcesSection
                commentsSection
                aboutSection
            }
            .navigationTitle(L10n.t("settings.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(role: .close) { dismiss() }
                        .accessibilityLabel(L10n.t("settings.close"))
                        .accessibilityIdentifier("settings-close")
                }
            }
            .confirmationDialog(L10n.t("ios.settings.resetIdentity"), isPresented: $confirmsReset, titleVisibility: .visible) {
                Button(L10n.t("ios.settings.resetConfirm"), role: .destructive) {
                    identity.reset()
                    didReset = true
                }
            } message: {
                Text(L10n.t("ios.settings.resetHint"))
            }
        }
        .accessibilityIdentifier("settings")
        .task { await sources.load() }
    }

    private var appearanceSection: some View {
        @Bindable var preferences = preferences
        return Section(L10n.t("settings.appearance")) {
            Picker(L10n.t("settings.appearance"), selection: $preferences.value.theme) {
                Text(L10n.t("theme.auto")).tag(Preferences.Theme.auto)
                Text(L10n.t("theme.light")).tag(Preferences.Theme.light)
                Text(L10n.t("theme.dark")).tag(Preferences.Theme.dark)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("settings-theme")
            VStack(alignment: .leading, spacing: 6) {
                Text(L10n.t("grid.size"))
                Slider(value: cardSize, in: -2...2, step: 1) {
                    Text(L10n.t("grid.size"))
                } minimumValueLabel: {
                    Image(systemName: "square.grid.3x3").imageScale(.small).accessibilityHidden(true)
                } maximumValueLabel: {
                    Image(systemName: "square.grid.2x2").imageScale(.large).accessibilityHidden(true)
                }
                .accessibilityValue(String(preferences.value.gridSize + 3) + " / 5")
                .accessibilityIdentifier("settings-card-size")
            }
        }
    }

    private var cardSize: Binding<Double> {
        Binding(get: { Double(preferences.value.gridSize) },
                set: { preferences.value.gridSize = Int($0.rounded()) })
    }

    /// Picking a language counts as asking for translation (web setLanguage).
    private var language: Binding<String> {
        Binding(get: { preferences.value.targetLang },
                set: { next in
                    guard next != preferences.value.targetLang else { return }
                    preferences.value.targetLang = next
                    if next != "en" { preferences.value.autoTranslate = true }
                })
    }

    private var languageSection: some View {
        @Bindable var preferences = preferences
        return Section {
            Picker(L10n.t("ios.settings.languagePicker"), selection: language) {
                ForEach(Language.all) { language in
                    Text(language.name).tag(language.code)
                }
            }
            .accessibilityIdentifier("settings-language")
            Toggle(L10n.t("lang.auto"), isOn: $preferences.value.autoTranslate)
                .accessibilityIdentifier("settings-auto-translate")
        } header: {
            Text(L10n.t("settings.language"))
        } footer: {
            Text(L10n.t("ios.settings.languageHint"))
        }
    }

    private var forecastSection: some View {
        @Bindable var preferences = preferences
        return Section {
            Toggle(L10n.t("ios.settings.forecastToggle"), isOn: $preferences.value.forecast)
                .accessibilityIdentifier("settings-forecast")
        } header: {
            Text(L10n.t("settings.forecast"))
        } footer: {
            Text(L10n.t("ios.settings.forecastHint"))
        }
    }

    private var sourcesSection: some View {
        Section {
            NavigationLink {
                SourcesSettings()
            } label: {
                LabeledContent(L10n.t("ios.settings.sourcesLink"), value: sourcesSummary)
            }
            .accessibilityIdentifier("settings-sources")
        } header: {
            Text(L10n.t("settings.sources"))
        } footer: {
            Text(L10n.t("settings.sourcesHint"))
        }
    }

    private var commentsSection: some View {
        Section {
            NavigationLink {
                BlockedSettings()
            } label: {
                LabeledContent(L10n.t("settings.blocked"), value: String(preferences.value.blockedAuthors.count))
            }
            .accessibilityIdentifier("settings-blocked")
            Button(L10n.t("settings.rules")) { open(MeridianLinks.terms) }
                .accessibilityIdentifier("settings-rules")
            Button(L10n.t("ios.settings.resetIdentity"), role: .destructive) { confirmsReset = true }
                .accessibilityIdentifier("settings-reset-identity")
        } header: {
            Text(L10n.t("settings.comments"))
        } footer: {
            Text(didReset ? L10n.t("ios.settings.resetDone") : L10n.t("settings.commentsHint"))
                .accessibilityIdentifier("settings-comments-footer")
        }
    }

    private var aboutSection: some View {
        Section(L10n.t("settings.about")) {
            Text(L10n.t("settings.aboutText"))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Button(L10n.t("settings.privacy")) { open(MeridianLinks.privacy) }
                .accessibilityIdentifier("settings-privacy")
            Button(L10n.t("settings.support")) { open(MeridianLinks.support) }
                .accessibilityIdentifier("settings-support")
            LabeledContent(L10n.t("ios.settings.version"), value: Self.version)
        }
    }

    private var sourcesSummary: String {
        guard let all = sources.response?.sources.filter({ !$0.battle && $0.enabled }), !all.isEmpty else { return "" }
        let hidden = Set(preferences.value.hiddenSources)
        return "\(all.filter { !hidden.contains($0.id) }.count) / \(all.count)"
    }

    private func open(_ url: URL) {
        openURL(url, prefersInApp: true)
    }

    static var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }
}

/// The sources by category, each switchable (web `renderSourcesList`): the outlet's flag, its
/// name, its kind — or NEEDS KEY for a keyed feed the server has no key for.
struct SourcesSettings: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(SourcesModel.self) private var sources

    var body: some View {
        List {
            if let response = sources.response {
                ForEach(groups(response), id: \.category) { group in
                    Section(NewsCategory(rawValue: group.category)?.label ?? group.category) {
                        ForEach(group.sources) { source in
                            SourceRow(source: source)
                        }
                    }
                }
            } else {
                Text(L10n.t("settings.sourcesLoading")).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(L10n.t("ios.settings.sourcesLink"))
        .accessibilityIdentifier("sources-list")
    }

    /// The server's category order, then any category it did not list (web: the same fold).
    private func groups(_ response: SourcesResponse) -> [(category: String, sources: [SourceInfo])] {
        let visible = response.sources.filter { !$0.battle }
        var order = response.categories
        for source in visible where !order.contains(source.category) { order.append(source.category) }
        return order.compactMap { category in
            let members = visible.filter { $0.category == category }
            return members.isEmpty ? nil : (category, members)
        }
    }
}

private struct SourceRow: View {
    let source: SourceInfo
    @Environment(PreferencesStore.self) private var preferences

    var body: some View {
        let hidden = preferences.value.hiddenSources.contains(source.id)
        Toggle(isOn: Binding(
            get: { source.enabled && !hidden },
            set: { on in
                // web: a Set spread back into the array — a newly hidden source joins at the end
                if on {
                    preferences.value.hiddenSources.removeAll { $0 == source.id }
                } else if !preferences.value.hiddenSources.contains(source.id) {
                    preferences.value.hiddenSources.append(source.id)
                }
            }
        )) {
            HStack(spacing: 10) {
                FlagView(source.provenance, size: 18, ringed: false)
                VStack(alignment: .leading, spacing: 2) {
                    Text(source.name)
                    Text(source.enabled ? source.type : L10n.t("settings.requiresKey")).captionVoice(.secondary)
                }
            }
        }
        .disabled(!source.enabled)
        .accessibilityIdentifier("source-\(source.id)")
    }
}

/// Commenters blocked from a comment's menu; unblocking brings their comments back the next time
/// a story's comments load (web `renderBlockedList`).
struct BlockedSettings: View {
    @Environment(PreferencesStore.self) private var preferences

    var body: some View {
        List {
            if preferences.value.blockedAuthors.isEmpty {
                Text(L10n.t("settings.blockedNone"))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("blocked-none")
            } else {
                ForEach(preferences.value.blockedAuthors, id: \.key) { blocked in
                    HStack {
                        Text(blocked.name.isEmpty ? blocked.key : blocked.name)
                        Spacer()
                        Button(L10n.t("settings.unblock")) { preferences.value.unblock(blocked.key) }
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier("unblock-\(blocked.key)")
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("blocked-\(blocked.key)")
                }
            }
        }
        .navigationTitle(L10n.t("settings.blocked"))
    }
}
