import AppKit
import Foundation

let fileManager = FileManager.default
let projectRoot = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let sourceURL = projectRoot.appendingPathComponent("assets/branding/homeypaw-mark-transparent.png")
let outputURL = projectRoot.appendingPathComponent("assets/branding/homeypaw-splash.png")

guard let mark = NSImage(contentsOf: sourceURL) else {
  fatalError("Unable to load HomeyPaw mark at \(sourceURL.path)")
}

let canvasSize = NSSize(width: 1024, height: 1024)
guard
  let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: Int(canvasSize.width),
    pixelsHigh: Int(canvasSize.height),
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ),
  let context = NSGraphicsContext(bitmapImageRep: bitmap)
else {
  fatalError("Unable to create the HomeyPaw splash canvas")
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(CGRect(origin: .zero, size: canvasSize))

mark.draw(
  in: NSRect(x: 182, y: 284, width: 660, height: 660),
  from: .zero,
  operation: .sourceOver,
  fraction: 1
)

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center

let wordmark = NSAttributedString(
  string: "HomeyPaw",
  attributes: [
    .font: NSFont.systemFont(ofSize: 112, weight: .bold),
    .foregroundColor: NSColor(calibratedRed: 44 / 255, green: 41 / 255, blue: 38 / 255, alpha: 1),
    .kern: -2,
    .paragraphStyle: paragraph,
  ]
)

wordmark.draw(in: NSRect(x: 82, y: 92, width: 860, height: 140))

NSGraphicsContext.restoreGraphicsState()

guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
  fatalError("Unable to encode the HomeyPaw splash PNG")
}

try pngData.write(to: outputURL, options: .atomic)
