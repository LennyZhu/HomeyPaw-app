#!/usr/bin/env swift

import AVFoundation
import Foundation

private enum Finding: String {
  case privacy = "PRIVACY"
  case timestampReview = "TIMESTAMP REVIEW"
  case other = "TECHNICAL/OTHER"
}

private let privacyTokens = [
  "location", "iso6709", "make", "model", "device", "software", "filename",
  "original", "title", "description", "comment", "author", "artist", "copyright",
]
private let timestampTokens = ["creationdate", "creation date", "creation_date", "date"]

private func printableValue(_ item: AVMetadataItem) async -> String {
  if let value = try? await item.load(.stringValue) {
    return value
  }
  if let value = try? await item.load(.numberValue) {
    return value.stringValue
  }
  if let value = try? await item.load(.dateValue) {
    return ISO8601DateFormatter().string(from: value)
  }
  guard (try? await item.load(.value)) != nil else {
    return "<none>"
  }
  return "<non-text value omitted>"
}

private func finding(for searchableText: String) -> Finding {
  let normalized = searchableText.lowercased()
  if privacyTokens.contains(where: normalized.contains) {
    return .privacy
  }
  if timestampTokens.contains(where: normalized.contains) {
    return .timestampReview
  }
  return .other
}

guard CommandLine.arguments.count == 2 else {
  FileHandle.standardError.write(
    Data("Usage: xcrun swift inspect-video-metadata.swift /path/to/video.mp4\n".utf8)
  )
  exit(64)
}

let fileURL = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL
guard FileManager.default.fileExists(atPath: fileURL.path) else {
  FileHandle.standardError.write(Data("Video not found: \(fileURL.path)\n".utf8))
  exit(66)
}

let asset = AVURLAsset(url: fileURL)
let commonMetadata: [AVMetadataItem]
let metadataFormats: [AVMetadataFormat]
do {
  commonMetadata = try await asset.load(.metadata)
  metadataFormats = try await asset.load(.availableMetadataFormats)
} catch {
  FileHandle.standardError.write(Data("Could not load video metadata: \(error)\n".utf8))
  exit(65)
}

var groups: [(name: String, items: [AVMetadataItem])] = [("common", commonMetadata)]
for format in metadataFormats {
  do {
    groups.append((format.rawValue, try await asset.loadMetadata(for: format)))
  } catch {
    FileHandle.standardError.write(
      Data("Could not load metadata format \(format.rawValue): \(error)\n".utf8)
    )
    exit(65)
  }
}

print("File: \(fileURL.path)")
print("Metadata formats: \(metadataFormats.map(\.rawValue).joined(separator: ", "))")

private var counts: [Finding: Int] = [:]
for group in groups where !group.items.isEmpty {
  print("\n[\(group.name)]")
  for item in group.items {
    let identifier = item.identifier?.rawValue ?? "<none>"
    let keySpace = item.keySpace?.rawValue ?? "<none>"
    let commonKey = item.commonKey?.rawValue ?? "<none>"
    let key = item.key.map { String(describing: $0) } ?? "<none>"
    let searchableText = [identifier, keySpace, commonKey, key].joined(separator: " ")
    let classification = finding(for: searchableText)
    counts[classification, default: 0] += 1
    print(
      "[\(classification.rawValue)] identifier=\(identifier) keySpace=\(keySpace) "
        + "commonKey=\(commonKey) key=\(key) value=\(await printableValue(item))"
    )
  }
}

print("\nSummary:")
print("  privacy candidates: \(counts[.privacy, default: 0])")
print("  timestamps requiring source/output comparison: \(counts[.timestampReview, default: 0])")
print("  technical/other items: \(counts[.other, default: 0])")
