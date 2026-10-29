// bogo-vision : lit l'horloge de la partie AoE4 dans la fenêtre GeForce Now.
//
// Lancé par BoGo, il capture la fenêtre une fois par seconde (ScreenCaptureKit),
// lit l'horloge en haut au centre et le panneau en bas à gauche (Vision), et écrit
// une ligne JSON par événement sur la sortie standard :
//   {"type":"clock","seconds":125,"text":"02:05"}
//   {"type":"top","tokens":[…]}   (textes lus en haut au centre : âge, passage d'âge en cours…)
//   {"type":"hud","tokens":[{"text":"7/10","x":0.2,"y":0.1,"w":0.1,"h":0.05}, …]}
//     (textes lus dans le panneau, positions en fraction de la zone, origine en haut à gauche ;
//      BoGo en déduit population, ressources et villageois par ressource)
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
/// Panneau population / ressources / villageois, en bas à gauche, avec de la marge.
let hudArea = CGRect(x: 0.0, y: 0.6, width: 0.18, height: 0.4)

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

/// Lit le texte d'une zone de l'image (fractions de l'image, origine en haut à gauche).
func recognizeText(in image: CGImage, area: CGRect) -> [VNRecognizedTextObservation] {
    let w = CGFloat(image.width), h = CGFloat(image.height)
    let pixels = CGRect(x: w * area.minX, y: h * area.minY, width: w * area.width, height: h * area.height)
    guard let crop = image.cropping(to: pixels.integral) else { return [] }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    try? VNImageRequestHandler(cgImage: crop).perform([request])
    return request.results ?? []
}

func tokens(_ observations: [VNRecognizedTextObservation]) -> [[String: Any]] {
    observations.compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        // Vision place l'origine en bas à gauche : on la ramène en haut à gauche.
        let box = observation.boundingBox
        return ["text": text, "x": box.minX, "y": 1 - box.maxY, "w": box.width, "h": box.height]
    }
}

func readClock(_ observations: [VNRecognizedTextObservation]) -> (seconds: Int, text: String)? {
    for observation in observations {
        for candidate in observation.topCandidates(3) {
            for token in candidate.string.split(whereSeparator: \.isWhitespace) {
                if let seconds = parseClock(String(token)) { return (seconds, String(token)) }
            }
        }
    }
    return nil
}

/// Erreur envoyée une fois tant qu'elle se répète ; le statut suivant sera renvoyé.
func emitError(_ code: String, _ message: String) {
    guard lastStatus != "error:\(code)" else { return }
    lastStatus = "error:\(code)"
    emit(["type": "error", "code": code, "message": message])
}

func run() async {
    // Demande l'autorisation une fois ; on ne s'arrête pas si elle manque : dès qu'elle est
    // donnée, la capture suivante réussit (macOS identifie mal une appli non signée à chaque
    // nouvelle version, l'autorisation peut arriver après le lancement).
    if !CGPreflightScreenCaptureAccess() {
        CGRequestScreenCaptureAccess()
    }
    while true {
        var delay: UInt64 = 1_000_000_000
        do {
            if let window = try await findGeForceNowWindow() {
                let image = try await capture(window)
                let top = recognizeText(in: image, area: clockArea)
                emit(["type": "top", "tokens": tokens(top)])
                if let clock = readClock(top) {
                    emitStatus("ok")
                    emit(["type": "clock", "seconds": clock.seconds, "text": clock.text])
                } else {
                    emitStatus("no_clock")
                }
                emit(["type": "hud", "tokens": tokens(recognizeText(in: image, area: hudArea))])
            } else {
                emitStatus("no_window")
            }
        } catch {
            delay = 3_000_000_000
            if CGPreflightScreenCaptureAccess() {
                emitError("capture", error.localizedDescription)
            } else {
                emitError(
                    "permission",
                    "Autorise BoGo dans Réglages Système → Confidentialité et sécurité → Enregistrement de l'écran "
                        + "(retire-le avec « − » et rajoute-le s'il y est déjà). La lecture reprendra toute seule."
                )
            }
        }
        try? await Task.sleep(nanoseconds: delay)
    }
}

Task { await run() }
dispatchMain()
