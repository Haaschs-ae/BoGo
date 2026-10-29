// bogo-vision : lit l'horloge de la partie AoE4 dans la fenêtre GeForce Now.
//
// Lancé par BoGo, il capture la fenêtre une fois par seconde (ScreenCaptureKit),
// lit le texte en haut au centre (Vision) et écrit une ligne JSON par événement
// sur la sortie standard :
//   {"type":"clock","seconds":125,"text":"02:05"}
//   {"type":"status","code":"no_window"|"no_clock"|"ok"}
//   {"type":"error","code":"permission"|"capture","message":"…"}
// Il s'arrête de lui-même quand BoGo se ferme (la sortie standard se ferme).

import CoreGraphics
import Foundation
import ScreenCaptureKit
import Vision

setvbuf(stdout, nil, _IOLBF, 0)

/// Zone lue, en fraction de la fenêtre : bande en haut au centre. Assez large pour
/// couvrir un stream 16:9 avec bandes noires dans un écran 16:10.
let clockArea = CGRect(x: 0.35, y: 0.0, width: 0.30, height: 0.25)

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}

var lastStatus = ""
func emitStatus(_ code: String) {
    // Les statuts ne sont envoyés que lorsqu'ils changent.
    guard code != lastStatus else { return }
    lastStatus = code
    emit(["type": "status", "code": code])
}

/// "02:05" → 125, "1:02:05" → 3725 ; nil si le texte n'est pas une horloge.
func parseClock(_ token: String) -> Int? {
    let text = token.replacingOccurrences(of: "O", with: "0").replacingOccurrences(of: "o", with: "0")
    let parts = text.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard (2...3).contains(parts.count) else { return nil }
    let values = parts.compactMap { part -> Int? in
        part.allSatisfy({ $0.isASCII && $0.isNumber }) ? Int(part) : nil
    }
    guard values.count == parts.count,
          parts.dropFirst().allSatisfy({ $0.count == 2 }),
          values.dropFirst().allSatisfy({ $0 < 60 }) else { return nil }
    return values.reduce(0) { $0 * 60 + $1 }
}

func findGeForceNowWindow() async throws -> SCWindow? {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    return content.windows
        .filter { window in
            let app = window.owningApplication
            let name = (app?.applicationName ?? "").lowercased()
            let bundle = (app?.bundleIdentifier ?? "").lowercased()
            return name.contains("geforce") || bundle.contains("nvidia")
        }
        .max { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height }
}

func capture(_ window: SCWindow) async throws -> CGImage {
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let scale = CGFloat(filter.pointPixelScale)
    let config = SCStreamConfiguration()
    config.width = Int(window.frame.width * scale)
    config.height = Int(window.frame.height * scale)
    config.showsCursor = false
    return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
}

func readClock(in image: CGImage) -> (seconds: Int, text: String)? {
    let w = CGFloat(image.width), h = CGFloat(image.height)
    let area = CGRect(x: w * clockArea.minX, y: h * clockArea.minY, width: w * clockArea.width, height: h * clockArea.height)
    guard let strip = image.cropping(to: area.integral) else { return nil }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: strip).perform([request])

    for observation in request.results ?? [] {
        for candidate in observation.topCandidates(3) {
            for token in candidate.string.split(whereSeparator: \.isWhitespace) {
                if let seconds = parseClock(String(token)) { return (seconds, String(token)) }
            }
        }
    }
    return nil
}

func run() async {
    if !CGPreflightScreenCaptureAccess() {
        CGRequestScreenCaptureAccess()
        emit([
            "type": "error",
            "code": "permission",
            "message": "Autorise BoGo dans Réglages Système → Confidentialité et sécurité → Enregistrement de l'écran, puis relance BoGo.",
        ])
        exit(2)
    }
    while true {
        do {
            if let window = try await findGeForceNowWindow() {
                let image = try await capture(window)
                if let clock = readClock(in: image) {
                    emitStatus("ok")
                    emit(["type": "clock", "seconds": clock.seconds, "text": clock.text])
                } else {
                    emitStatus("no_clock")
                }
            } else {
                emitStatus("no_window")
            }
        } catch {
            emit(["type": "error", "code": "capture", "message": error.localizedDescription])
        }
        try? await Task.sleep(nanoseconds: 1_000_000_000)
    }
}

Task { await run() }
dispatchMain()
