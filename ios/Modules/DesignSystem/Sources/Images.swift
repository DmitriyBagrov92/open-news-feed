import Dependencies
import ImageIO
import SwiftUI
import UIKit

/// A decoded image plus the source's pixel width (the web demotes a hero image narrower than
/// 620 px to the letter tile).
public struct LoadedImage: @unchecked Sendable {
    public let image: UIImage
    public let pixelWidth: Int

    public init(image: UIImage, pixelWidth: Int) {
        self.image = image
        self.pixelWidth = pixelWidth
    }
}

/// Loads article photography: bytes through a dedicated URLSession with a disk cache, decoded
/// off the main thread straight to display size by ImageIO (no full-size bitmaps in memory),
/// decoded results in a cost-limited memory cache, concurrent requests for one URL coalesced.
public actor ImagePipeline {
    public static let shared = ImagePipeline()

    private let session: URLSession
    private let memory = NSCache<NSString, CachedImage>()
    private var inFlight: [String: Task<LoadedImage?, Never>] = [:]

    private final class CachedImage {
        let value: LoadedImage
        init(_ value: LoadedImage) { self.value = value }
    }

    public init() {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 300 << 20)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.timeoutIntervalForRequest = 20
        configuration.httpMaximumConnectionsPerHost = 6
        session = URLSession(configuration: configuration)
        memory.totalCostLimit = 60 << 20
    }

    public func image(for url: URL, maxPixelSize: CGFloat) async -> LoadedImage? {
        let key = "\(url.absoluteString)#\(Int(maxPixelSize))"
        if let cached = memory.object(forKey: key as NSString) { return cached.value }
        if let task = inFlight[key] { return await task.value }
        let session = session
        let task = Task.detached(priority: .userInitiated) { () -> LoadedImage? in
            guard let (data, response) = try? await session.data(from: url),
                  (response as? HTTPURLResponse).map({ (200..<300).contains($0.statusCode) }) ?? false
            else { return nil }
            return ImagePipeline.decode(data, maxPixelSize: maxPixelSize)
        }
        inFlight[key] = task
        let result = await task.value
        inFlight[key] = nil
        if let result {
            let cost = Int(result.image.size.width * result.image.size.height * result.image.scale * result.image.scale * 4)
            memory.setObject(CachedImage(result), forKey: key as NSString, cost: cost)
        }
        return result
    }

    /// Decodes straight to `maxPixelSize` on the long side (ImageIO thumbnailing, EXIF orientation applied).
    public static func decode(_ data: Data, maxPixelSize: CGFloat) -> LoadedImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let width = properties?[kCGImagePropertyPixelWidth] as? Int ?? 0
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixelSize),
        ]
        guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return LoadedImage(image: UIImage(cgImage: thumbnail), pixelWidth: width)
    }
}

/// How views get images — the pipeline live, nothing in tests (fixture images never resolve).
public struct ImageLoader: Sendable {
    public var load: @Sendable (_ url: URL, _ maxPixelSize: CGFloat) async -> LoadedImage?

    public init(load: @escaping @Sendable (_ url: URL, _ maxPixelSize: CGFloat) async -> LoadedImage?) {
        self.load = load
    }
}

extension ImageLoader: DependencyKey {
    public static let liveValue = ImageLoader { url, size in await ImagePipeline.shared.image(for: url, maxPixelSize: size) }
    public static let testValue = ImageLoader { _, _ in nil }
}

public extension DependencyValues {
    var imageLoader: ImageLoader {
        get { self[ImageLoader.self] }
        set { self[ImageLoader.self] = newValue }
    }
}

/// A remote photo that fades in over its placeholder; the decoded size follows the view.
public struct RemoteImage<Placeholder: View>: View {
    private let url: URL?
    private let minimumPixelWidth: Int
    private let placeholder: Placeholder
    @State private var loaded: LoadedImage?
    @Environment(\.displayScale) private var displayScale
    @Dependency(\.imageLoader) private var loader

    /// - Parameter minimumPixelWidth: images narrower than this at source stay on the placeholder.
    public init(url: URL?, minimumPixelWidth: Int = 0, @ViewBuilder placeholder: () -> Placeholder) {
        self.url = url
        self.minimumPixelWidth = minimumPixelWidth
        self.placeholder = placeholder()
    }

    public var body: some View {
        GeometryReader { geometry in
            ZStack {
                placeholder
                if let loaded {
                    Image(uiImage: loaded.image)
                        .resizable()
                        .scaledToFill()
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                        .transition(.opacity)
                }
            }
            .task(id: url) {
                loaded = nil
                guard let url, geometry.size.width > 0 else { return }
                let pixels = max(geometry.size.width, geometry.size.height) * displayScale
                guard let image = await loader.load(url, pixels), !Task.isCancelled,
                      image.pixelWidth == 0 || image.pixelWidth >= minimumPixelWidth
                else { return }
                withAnimation(.easeOut(duration: 0.35)) { loaded = image }
            }
        }
        .accessibilityHidden(true)
    }
}
