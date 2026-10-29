use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

/// Télécharge un BO aoe4guides au format overlay (celui de RTS_Overlay).
#[tauri::command]
async fn fetch_aoe4guides_build(id: String) -> Result<serde_json::Value, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Identifiant de build invalide.".into());
    }
    get_json("aoe4guides", &format!("https://aoe4guides.com/api/builds/{id}?overlay=true")).await
}

/// Dernière partie (en cours ou terminée) d'un joueur, d'après AoE4World.
/// La clé API, facultative, fait aussi remonter les parties personnalisées.
#[tauri::command]
async fn fetch_last_game(profile_id: String, api_key: Option<String>) -> Result<serde_json::Value, String> {
    if profile_id.is_empty() || !profile_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Identifiant de profil AoE4World invalide.".into());
    }
    let mut url = format!("https://aoe4world.com/api/v0/players/{profile_id}/games/last?include_alts=true");
    if let Some(key) = api_key.filter(|k| !k.is_empty()) {
        if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
            return Err("Clé API AoE4World invalide.".into());
        }
        url.push_str(&format!("&api_key={key}&include_custom=true"));
    }
    get_json("AoE4World", &url).await
}

/// Client HTTP partagé : connexions réutilisées, délai maximal (une réponse qui traîne ne
/// bloque pas le sondage suivant) et un User-Agent qui nomme BoGo auprès des deux sites.
fn http() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .user_agent(concat!("BoGo/", env!("CARGO_PKG_VERSION"), " (+https://github.com/Haaschs-ae/BoGo)"))
            .build()
            .expect("client HTTP")
    })
}

async fn get_json(site: &str, url: &str) -> Result<serde_json::Value, String> {
    let response = http()
        .get(url)
        .send()
        .await
        // Sans l'URL : elle contient la clé API, et ce message est affiché dans les réglages.
        .map_err(|e| format!("Connexion à {site} impossible : {}", e.without_url()))?;
    if !response.status().is_success() {
        return Err(format!("{site} a répondu {}.", response.status()));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Réponse de {site} illisible : {e}"))
}

const IMPORT_HOST: &str = "bogo.import";
const STYLES: [&str; 4] = ["boom", "agressif", "fast-castle", "autre"];

/// Ouvre aoe4guides.com dans une fenêtre de BoGo. Sur la page d'un build, un panneau
/// injecté propose de l'importer : le clic navigue vers https://bogo.import/<id>?style=…,
/// navigation interceptée ici et transmise à l'overlay (événement « import-request »).
#[tauri::command]
async fn open_aoe4guides(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("aoe4guides") {
        let _ = window.show();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let handle = app.clone();
    WebviewWindowBuilder::new(
        &app,
        "aoe4guides",
        WebviewUrl::External("https://aoe4guides.com/".parse().expect("adresse valide")),
    )
    .title("aoe4guides · BoGo")
    .inner_size(1200.0, 820.0)
    .initialization_script(include_str!("aoe4guides_import.js"))
    .on_navigation(move |url| {
        if url.host_str() != Some(IMPORT_HOST) {
            return true;
        }
        let id = url.path().trim_matches('/');
        let style = url
            .query_pairs()
            .find(|(key, _)| key == "style")
            .map(|(_, value)| value.into_owned())
            .filter(|style| STYLES.contains(&style.as_str()))
            .unwrap_or_else(|| "autre".into());
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()) {
            let _ = handle.emit_to("overlay", "import-request", serde_json::json!({ "id": id, "style": style }));
        }
        false
    })
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Enregistrement de la partie en cours : les lignes lues à l'écran et les repères de BoGo
/// (BO lancé, étape changée au clavier, fin), pour rejouer une partie hors ligne.
/// Fichier local, jamais envoyé.
#[derive(Default)]
struct Recorder(Mutex<Option<File>>);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Ajoute une ligne horodatée à l'enregistrement, s'il y en a un en cours.
fn record(app: &AppHandle, mut event: serde_json::Value) {
    // La liste des applis ouvertes (fenêtre GeForce Now introuvable) n'a rien à faire dans un
    // fichier qu'on peut être amené à partager.
    if let Some(fields) = event.as_object_mut() {
        fields.remove("apps");
    }
    let recorder = app.state::<Recorder>();
    let Ok(mut guard) = recorder.0.lock() else {
        return;
    };
    if let Some(file) = guard.as_mut() {
        let line = serde_json::json!({ "t": now_ms(), "event": event });
        let _ = writeln!(file, "{line}");
    }
}

/// Démarre un nouveau fichier d'enregistrement (`enabled`) ou arrête l'enregistrement.
/// Renvoie le chemin du fichier créé.
#[tauri::command]
fn set_recording(app: AppHandle, enabled: bool) -> Result<Option<String>, String> {
    let recorder = app.state::<Recorder>();
    let mut current = recorder.0.lock().map_err(|e| e.to_string())?;
    *current = None;
    if !enabled {
        return Ok(None);
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("parties");
    std::fs::create_dir_all(&dir).map_err(|e| format!("dossier {} impossible à créer ({e})", dir.display()))?;
    let path = dir.join(format!("partie-{}.jsonl", now_ms() / 1000));
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("fichier {} impossible à créer ({e})", path.display()))?;
    *current = Some(file);
    Ok(Some(path.display().to_string()))
}

/// Repère ajouté par l'interface (BO lancé, étape changée au clavier, fin du BO).
#[tauri::command]
fn record_event(app: AppHandle, event: serde_json::Value) {
    record(&app, event);
}

/// Journal local des parties (conseil de BO au début de la partie) : app-data/journal.json.
fn journal_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("journal.json"))
}

/// Contenu du journal, ou une chaîne vide s'il n'existe pas encore.
#[tauri::command]
fn journal_read(app: AppHandle) -> Result<String, String> {
    match std::fs::read_to_string(journal_path(&app)?) {
        Ok(text) => Ok(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Réécrit le journal d'un bloc (fichier temporaire puis renommage : jamais à moitié écrit).
#[tauri::command]
fn journal_write(app: AppHandle, text: String) -> Result<(), String> {
    let path = journal_path(&app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Processus bogo-vision en cours (lecture de l'horloge à l'écran).
#[derive(Default)]
struct Vision(Mutex<Option<Child>>);

/// Lance bogo-vision et relaie chacune de ses lignes JSON à l'interface (événement « vision »).
#[tauri::command]
fn start_vision(app: AppHandle, vision: State<Vision>) -> Result<(), String> {
    let mut running = vision.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = running.as_mut() {
        if matches!(child.try_wait(), Ok(None)) {
            return Ok(());
        }
    }
    if !cfg!(target_os = "macos") {
        return Err("La lecture de l'écran n'existe que sur macOS pour l'instant.".into());
    }
    // Tauri place les binaires externes à côté de l'exécutable de l'appli.
    let helper = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .with_file_name("bogo-vision");
    let mut child = Command::new(&helper)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Impossible de lancer la lecture de l'écran ({}) : {e}", helper.display()))?;
    let stdout = child.stdout.take().ok_or("Sortie de bogo-vision indisponible.")?;
    let stderr = child.stderr.take().ok_or("Sortie d'erreur de bogo-vision indisponible.")?;
    // Garde les dernières lignes d'erreur pour expliquer un arrêt (plantage, bibliothèque absente…).
    let errors = std::thread::spawn(move || {
        let mut last: Vec<String> = Vec::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            last.push(line);
            if last.len() > 5 {
                last.remove(0);
            }
        }
        last.join(" | ")
    });
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                record(&app, event.clone());
                let _ = app.emit("vision", event);
            }
        }
        let status = app
            .state::<Vision>()
            .0
            .lock()
            .ok()
            .and_then(|mut running| running.as_mut().and_then(|c| c.wait().ok()))
            .map(|s| s.to_string())
            .unwrap_or_default();
        let detail = errors.join().unwrap_or_default();
        let stopped = serde_json::json!({ "type": "stopped", "status": status, "detail": detail });
        record(&app, stopped.clone());
        let _ = app.emit("vision", stopped);
    });
    *running = Some(child);
    Ok(())
}

#[tauri::command]
fn stop_vision(vision: State<Vision>) {
    if let Ok(mut running) = vision.0.lock() {
        if let Some(mut child) = running.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Appelé régulièrement par l'interface : ramène l'overlay devant le jeu,
/// macOS pouvant repasser GeForce Now devant en changeant de bureau ou de plein écran.
#[tauri::command]
fn keep_overlay_on_top(app: AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || macos::bring_to_front(&handle));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command]
fn quit(app: AppHandle, vision: State<Vision>) {
    stop_vision(vision);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(Vision::default())
        .manage(Recorder::default())
        .invoke_handler(tauri::generate_handler![
            fetch_aoe4guides_build,
            fetch_last_game,
            open_aoe4guides,
            keep_overlay_on_top,
            start_vision,
            stop_vision,
            set_recording,
            record_event,
            journal_read,
            journal_write,
            quit
        ])
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                // Appli « accessoire » : pas d'icône dans le Dock, et ses fenêtres
                // peuvent s'afficher dans l'espace plein écran d'une autre appli.
                _app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                macos::float_over_fullscreen(_app.handle())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de BoGo");
}

#[cfg(target_os = "macos")]
mod macos {
    use tauri::{AppHandle, Manager};
    use tauri_nspanel::{tauri_panel, CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

    tauri_panel! {
        panel!(OverlayPanel {
            config: {
                can_become_key_window: true,
                is_floating_panel: true
            }
        })
    }

    /// Transforme l'overlay en NSPanel non activant : présent sur tous les bureaux, y compris
    /// celui de GeForce Now en plein écran, au-dessus du jeu, sans lui voler le focus.
    /// À appeler sur le fil principal.
    pub fn float_over_fullscreen(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let window = app.get_webview_window("overlay").ok_or("fenêtre overlay introuvable")?;
        let panel = window.to_panel::<OverlayPanel>()?;
        panel.set_level(PanelLevel::ScreenSaver.value());
        panel
            .add_style_mask(StyleMask::empty().nonactivating_panel().into())
            .map_err(|e| format!("{e:?}"))?;
        panel.set_collection_behavior(
            CollectionBehavior::new()
                .can_join_all_spaces()
                .full_screen_auxiliary()
                .stationary()
                .ignores_cycle()
                .into(),
        );
        Ok(())
    }

    /// Ramène l'overlay devant le jeu s'il est affiché. À appeler sur le fil principal.
    pub fn bring_to_front(app: &AppHandle) {
        if let Ok(panel) = app.get_webview_panel("overlay") {
            if panel.is_visible() {
                panel.order_front_regardless();
            }
        }
    }
}
