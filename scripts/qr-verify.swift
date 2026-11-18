import Foundation
import CoreGraphics
import Vision

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    FileHandle.standardError.write("usage: qr-verify.swift <matrix.txt>\n".data(using: .utf8)!)
    exit(2)
}

let path = arguments[1]
guard let content = try? String(contentsOfFile: path, encoding: .utf8) else {
    FileHandle.standardError.write("cannot read matrix file\n".data(using: .utf8)!)
    exit(2)
}

let rows = content.split(separator: "\n").map(String.init)
let size = rows.count
guard size >= 21 else {
    FileHandle.standardError.write("invalid matrix height\n".data(using: .utf8)!)
    exit(2)
}

var pixels = [UInt8](repeating: 255, count: size * size)
for (rowIndex, row) in rows.enumerated() where row.count == size {
    for (colIndex, character) in row.enumerated() where character == "1" {
        pixels[rowIndex * size + colIndex] = 0
    }
}

let colorSpace = CGColorSpaceCreateDeviceGray()
guard let provider = CGDataProvider(data: Data(pixels) as CFData) else {
    exit(3)
}

guard let image = CGImage(
    width: size,
    height: size,
    bitsPerComponent: 8,
    bitsPerPixel: 8,
    bytesPerRow: size,
    space: colorSpace,
    bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
    provider: provider,
    decode: nil,
    shouldInterpolate: false,
    intent: .defaultIntent
) else {
    exit(4)
}

let margin = 4
let scale = 10
let total = (size + margin * 2) * scale

guard let context = CGContext(
    data: nil,
    width: total,
    height: total,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.none.rawValue
) else {
    exit(5)
}
context.interpolationQuality = .none
context.setFillColor(gray: 1, alpha: 1)
context.fill(CGRect(x: 0, y: 0, width: total, height: total))
context.draw(
    image,
    in: CGRect(x: margin * scale, y: margin * scale, width: size * scale, height: size * scale)
)

guard let scaled = context.makeImage() else {
    exit(6)
}

let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
let handler = VNImageRequestHandler(cgImage: scaled, options: [:])

do {
    try handler.perform([request])
} catch {
    print("VISION_UNAVAILABLE")
    exit(3)
}

if let payload = request.results?.first?.payloadStringValue {
    print(payload)
} else {
    print("DECODE_FAILED")
    exit(1)
}