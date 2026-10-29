// bogo-translate : traduit en français les consignes d'un BO écrit en anglais, avec la
// traduction intégrée de macOS (sur la machine, sans réseau, macOS 15 ou plus).
//
// Lancé par BoGo à l'import d'un BO (jamais pendant une partie). Il lit sur l'entrée standard un
// tableau JSON de textes, et écrit une seule ligne JSON sur la sortie standard :
//   {"ok":true,"texts":["…", …]}     (dans le même ordre)
//   {"ok":false,"error":"…"}
// Au premier usage, macOS peut proposer de télécharger le français et l'anglais : la petite
// fenêtre « BoGo » sert à ça, elle se ferme toute seule.

import AppKit
import SwiftUI
import Translation

setvbuf(stdout, nil, _IOLBF, 0)

func finish(_ object: [String: Any]) -> Never {
    if let data = try? JSONSerialization.data(withJSONObject: object), let line = String(data: data, encoding: .utf8) {
        print(line)
    }
    exit(0)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let texts = (try? JSONSerialization.jsonObject(with: input)) as? [String] else {
    finish(["ok": false, "error": "entrée illisible"])
}
if texts.isEmpty { finish(["ok": true, "texts": [String]()]) }

struct TranslatorView: View {
    let texts: [String]
    @State private var configuration = TranslationSession.Configuration(
        source: Locale.Language(identifier: "en"),
        target: Locale.Language(identifier: "fr")
    )

    var body: some View {
        Text("BoGo traduit tes BO en français…")
            .padding(16)
            .translationTask(configuration) { session in
                do {
                    try await session.prepareTranslation()
                    let requests = texts.enumerated().map {
                        TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
                    }
                    var out = texts
                    for response in try await session.translations(from: requests) {
                        if let id = response.clientIdentifier, let index = Int(id) { out[index] = response.targetText }
                    }
                    finish(["ok": true, "texts": out])
                } catch {
                    finish(["ok": false, "error": "\(error)"])
                }
            }
    }
}

// Une petite fenêtre : la traduction de macOS a besoin d'une vue affichée (et y propose le
// téléchargement des langues au premier usage). Pas d'icône dans le Dock.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let window = NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 300, height: 60),
    styleMask: [.titled],
    backing: .buffered,
    defer: false
)
window.title = "BoGo"
window.contentView = NSHostingView(rootView: TranslatorView(texts: texts))
window.center()
window.orderFrontRegardless()
app.run()
