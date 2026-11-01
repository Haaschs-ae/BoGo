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

import AppKit
import CoreGraphics
import Foundation
import ScreenCaptureKit
import Vision

setvbuf(stdout, nil, _IOLBF, 0)

// Un outil en ligne de commande doit ouvrir sa connexion au serveur de fenêtres avant
// d'utiliser ScreenCaptureKit, sinon il plante (« CGS_REQUIRE_INIT »). Pas d'icône dans le Dock.
NSApplication.shared.setActivationPolicy(.prohibited)
_ = CGMainDisplayID()

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

/// Applis qui ont des fenêtres, envoyées avec « no_window » pour comprendre une recherche ratée.
var visibleApps: [String] = []

func findGeForceNowWindow() async throws -> SCWindow? {
    // Toutes les fenêtres, pas seulement celles à l'écran : GeForce Now en plein écran
    // est sur son propre bureau, invisible quand on regarde un autre bureau.
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    visibleApps = Array(Set(content.windows.compactMap { $0.owningApplication?.applicationName })).sorted()
    return content.windows
        .filter { window in
            let app = window.owningApplication
            let name = (app?.applicationName ?? "").lowercased()
            let bundle = (app?.bundleIdentifier ?? "").lowercased()
            return (name.contains("geforce") || bundle.contains("nvidia")) && window.frame.width > 200
        }
        // La fenêtre à l'écran d'abord, puis la plus grande.
        .max { ($0.isOnScreen ? 1 : 0, $0.frame.width * $0.frame.height) < ($1.isOnScreen ? 1 : 0, $1.frame.width * $1.frame.height) }
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
    // Par défaut, Vision ignore le texte de moins de 1/32 de la hauteur de l'image : les petits
    // chiffres des villageois par ressource (≈ 1/30 du panneau) sautaient une lecture sur deux.
    request.minimumTextHeight = 1.0 / 80.0
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

// ---------- Panneau des villageois : lecture renforcée ----------
// Trois lectures du panneau, fusionnées : l'image telle quelle ; la même en texte sombre sur
// fond clair (contraste poussé) pour ce qui aurait échappé ; et les chiffres de la colonne des
// villageois par ressource, alignés sur une ligne (un chiffre seul, « 3 », est souvent sauté).
// Même méthode que bogo-vision pour Windows (vision-win/src/common.rs).

/// Texte lu, position en fraction de l'image lue, origine en haut à gauche.
struct Word {
    var text: String
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

/// Rectangle en pixels.
struct Cell {
    var x: Int
    var y: Int
    var w: Int
    var h: Int
}

/// Colonne des villageois par ressource, en fraction de la largeur du panneau.
let gathererColumn = (0.40, 0.55)

func crop(_ image: CGImage, _ area: CGRect) -> CGImage? {
    let w = CGFloat(image.width), h = CGFloat(image.height)
    let pixels = CGRect(x: w * area.minX, y: h * area.minY, width: w * area.width, height: h * area.height)
    return image.cropping(to: pixels.integral)
}

/// Mots lus dans une image ; `splitWords` : un mot par morceau séparé d'espaces (sinon une ligne).
func recognizeWords(_ image: CGImage, splitWords: Bool) -> [Word] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.minimumTextHeight = 1.0 / 80.0
    try? VNImageRequestHandler(cgImage: image).perform([request])
    var words: [Word] = []
    for observation in request.results ?? [] {
        guard let candidate = observation.topCandidates(1).first else { continue }
        if !splitWords {
            let b = observation.boundingBox
            words.append(Word(text: candidate.string, x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height))
            continue
        }
        let text = candidate.string
        for part in text.split(separator: " ") {
            guard let box = try? candidate.boundingBox(for: part.startIndex..<part.endIndex) else { continue }
            let b = box.boundingBox
            words.append(Word(text: String(part), x: b.minX, y: 1 - b.maxY, w: b.width, h: b.height))
        }
    }
    return words
}

/// Niveaux de gris inversés, contraste poussé : texte sombre sur fond clair (1 octet par pixel).
func invertedGray(_ image: CGImage) -> [UInt8]? {
    let w = image.width, h = image.height
    var pixels = [UInt8](repeating: 0, count: w * h)
    let drawn = pixels.withUnsafeMutableBytes { buffer -> Bool in
        guard let context = CGContext(
            data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return false }
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return true
    }
    guard drawn else { return nil }
    for i in 0..<pixels.count {
        let inverted = 255.0 - Double(pixels[i])
        pixels[i] = UInt8(max(0.0, min(255.0, ((inverted - 60.0) * 255.0 / 140.0).rounded())))
    }
    return pixels
}

func grayImage(_ pixels: [UInt8], _ w: Int, _ h: Int) -> CGImage? {
    guard let provider = CGDataProvider(data: Data(pixels) as CFData) else { return nil }
    return CGImage(
        width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
        provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent
    )
}

/// Chiffres de la colonne des villageois : taches sombres de la taille d'un chiffre, l'icône
/// (plus haute, ou coupée par le bord) écartée, chiffres voisins de même taille groupés.
func digitCells(_ p: [UInt8], _ width: Int, _ height: Int, _ x0: Int, _ x1In: Int) -> [Cell] {
    let x1 = min(x1In, width)
    guard x0 < x1, height > 0 else { return [] }
    var seen = [Bool](repeating: false, count: width * height)
    var blobs: [Cell] = []
    for y in 0..<height {
        for x in x0..<x1 {
            if seen[y * width + x] || p[y * width + x] >= 128 { continue }
            var left = x, right = x, top = y, bottom = y
            var stack = [(x, y)]
            seen[y * width + x] = true
            while let point = stack.popLast() {
                let (cx, cy) = point
                left = min(left, cx); right = max(right, cx); top = min(top, cy); bottom = max(bottom, cy)
                for (nx, ny) in [(cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)] {
                    if nx >= x0 && nx < x1 && ny >= 0 && ny < height && !seen[ny * width + nx] && p[ny * width + nx] < 128 {
                        seen[ny * width + nx] = true
                        stack.append((nx, ny))
                    }
                }
            }
            let w = right - left + 1, h = bottom - top + 1
            let sizeOK = Double(h) >= 0.018 * Double(height) && Double(h) <= 0.06 * Double(height)
            if sizeOK && w * 5 <= h * 6 && left > x0 {
                blobs.append(Cell(x: left, y: top, w: w, h: h))
            }
        }
    }
    let heights = blobs.map { $0.h }.sorted()
    if !heights.isEmpty {
        let median = heights[heights.count / 2]
        blobs = blobs.filter { $0.h * 4 <= median * 5 }
    }
    blobs.sort { ($0.y, $0.x) < ($1.y, $1.x) }
    var cells: [Cell] = []
    for b in blobs {
        let joined = cells.firstIndex { c in
            let overlap = Double(min(c.y + c.h, b.y + b.h) - max(c.y, b.y))
            let gap = Double(b.x - (c.x + c.w))
            let similar = max(c.h, b.h) * 4 <= min(c.h, b.h) * 5
            return similar && overlap >= 0.5 * Double(min(c.h, b.h)) && gap <= Double(max(c.h, b.h)) && gap > -Double(b.w)
        }
        if let i = joined {
            var c = cells[i]
            let right = max(c.x + c.w, b.x + b.w), bottom = max(c.y + c.h, b.y + b.h)
            c.x = min(c.x, b.x); c.y = min(c.y, b.y); c.w = right - c.x; c.h = bottom - c.y
            cells[i] = c
        } else {
            cells.append(b)
        }
    }
    return cells
}

/// Les nombres copiés côte à côte sur une ligne (fond blanc, espacés comme des mots), et la
/// place de chacun (début, fin en x).
func composeCells(_ p: [UInt8], _ width: Int, _ cells: [Cell]) -> (pixels: [UInt8], w: Int, h: Int, places: [(Int, Int)]) {
    let tallest = cells.map { $0.h }.max() ?? 1
    let pad = tallest, gap = tallest * 3 / 2
    let ch = max(tallest + 2 * pad, 48)
    let cw = max(pad * 2 + cells.reduce(0) { $0 + $1.w + gap }, 64)
    var canvas = [UInt8](repeating: 255, count: cw * ch)
    var places: [(Int, Int)] = []
    var x = pad
    for c in cells {
        let top = max(0, ch - pad - c.h)
        for row in 0..<c.h {
            for col in 0..<c.w {
                canvas[(top + row) * cw + x + col] = p[(c.y + row) * width + c.x + col]
            }
        }
        places.append((x, x + c.w))
        x += c.w + gap
    }
    return (canvas, cw, ch, places)
}

/// Part de la plus petite des deux boîtes couverte par l'autre.
func overlap(_ a: Word, _ b: Word) -> Double {
    let w = min(a.x + a.w, b.x + b.w) - max(a.x, b.x)
    let h = min(a.y + a.h, b.y + b.h) - max(a.y, b.y)
    let smaller = min(a.w * a.h, b.w * b.h)
    return w <= 0 || h <= 0 || smaller <= 0 ? 0 : w * h / smaller
}

/// Tous les mots de la première lecture, plus ceux de la seconde qui ne recouvrent rien.
func mergeWords(_ first: [Word], _ second: [Word]) -> [Word] {
    var words = first
    for word in second where !words.contains(where: { overlap($0, word) > 0.3 }) {
        words.append(word)
    }
    return words
}

/// Panneau des villageois lu trois fois (voir plus haut), en jetons pour BoGo.
func readHud(_ image: CGImage) -> [[String: Any]] {
    guard let panel = crop(image, hudArea) else { return [] }
    var words = recognizeWords(panel, splitWords: false)
    let (w, h) = (panel.width, panel.height)
    if let gray = invertedGray(panel) {
        if let inverted = grayImage(gray, w, h) {
            words = mergeWords(words, recognizeWords(inverted, splitWords: false))
        }
        let cells = digitCells(gray, w, h, Int(Double(w) * gathererColumn.0), Int(Double(w) * gathererColumn.1))
        let line: (pixels: [UInt8], w: Int, h: Int, places: [(Int, Int)])? = cells.isEmpty ? nil : composeCells(gray, w, cells)
        if let line = line, let lineImage = grayImage(line.pixels, line.w, line.h) {
            var column: [Word] = []
            for word in recognizeWords(lineImage, splitWords: true) {
                let start = word.x * Double(line.w), end = (word.x + word.w) * Double(line.w)
                let hits = line.places.indices.filter { Double(line.places[$0].1) > start && Double(line.places[$0].0) < end }
                guard hits.count == 1 else { continue }
                let c = cells[hits[0]]
                column.append(Word(
                    text: word.text, x: Double(c.x) / Double(w), y: Double(c.y) / Double(h),
                    w: Double(c.w) / Double(w), h: Double(c.h) / Double(h)
                ))
            }
            words = mergeWords(column, words)
        }
    }
    return words.map { ["text": $0.text, "x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h] }
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
                emit(["type": "hud", "tokens": readHud(image)])
            } else if lastStatus != "no_window" {
                lastStatus = "no_window"
                emit(["type": "status", "code": "no_window", "apps": visibleApps])
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
        // Une ligne vide chaque tour (ignorée par BoGo) : BoGo fermé, l'écriture échoue et
        // arrête bogo-vision, même quand aucun statut ne change (pas de fenêtre GeForce Now).
        print("")
        try? await Task.sleep(nanoseconds: delay)
    }
}

Task { await run() }
dispatchMain()
