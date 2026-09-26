#!/usr/bin/env swift
// Renders the iOS App Icon (1024×1024, no alpha — App Store requirement) from the brand mark in
// scripts/brand-assets.sh: a meridian line through a ring, system blue on a soft white gradient.
// Full bleed (iOS applies its own corner mask), in the three iOS 18+ appearances.
//
//   swift ios/scripts/app-icon.swift ios/App/Resources/Assets.xcassets/AppIcon.appiconset

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let outDir = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".")
let size = 1024

struct Appearance {
    let file: String
    let top: CGColor
    let bottom: CGColor
    let mark: CGColor
}

func rgb(_ hex: UInt32) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
        green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255,
        alpha: 1
    )
}

let appearances = [
    Appearance(file: "icon-light.png", top: rgb(0xFFFFFF), bottom: rgb(0xEEF0F4), mark: rgb(0x007AFF)),
    Appearance(file: "icon-dark.png", top: rgb(0x1C1C1E), bottom: rgb(0x000000), mark: rgb(0x0A84FF)),
    // Tinted: a grayscale image; the system maps its luminance onto the user's tint.
    Appearance(file: "icon-tinted.png", top: rgb(0x2C2C2E), bottom: rgb(0x000000), mark: rgb(0xFFFFFF)),
]

for appearance in appearances {
    guard let context = CGContext(
        data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else { fatalError("no context") }

    // CoreGraphics' origin is bottom-left: draw the gradient from the top edge down.
    let gradient = CGGradient(
        colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
        colors: [appearance.top, appearance.bottom] as CFArray,
        locations: [0, 1]
    )!
    context.drawLinearGradient(
        gradient,
        start: CGPoint(x: 0, y: size), end: CGPoint(x: 0, y: 0),
        options: [.drawsBeforeStartLocation, .drawsAfterEndLocation]
    )

    let center = CGFloat(size) / 2
    let radius: CGFloat = 260
    context.setStrokeColor(appearance.mark)
    context.setLineWidth(72)
    context.strokeEllipse(in: CGRect(x: center - radius, y: center - radius, width: radius * 2, height: radius * 2))
    context.setLineCap(.round)
    context.move(to: CGPoint(x: center, y: center - radius - 96))
    context.addLine(to: CGPoint(x: center, y: center + radius + 96))
    context.strokePath()

    let image = context.makeImage()!
    let url = outDir.appendingPathComponent(appearance.file)
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("could not write \(url.path)") }
    print("wrote \(url.path)")
}

let contents = """
{
  "images" : [
    {
      "filename" : "icon-light.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ],
      "filename" : "icon-dark.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    },
    {
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "tinted"
        }
      ],
      "filename" : "icon-tinted.png",
      "idiom" : "universal",
      "platform" : "ios",
      "size" : "1024x1024"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}

"""
try! contents.write(to: outDir.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
