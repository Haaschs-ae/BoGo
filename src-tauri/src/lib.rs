use std::io::{BufRead, BufReader};
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

async fn get_json(site: &str, url: &str) -> Result<serde_json::Value, String> {
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Connexion à {site} impossible : {e}"))?;
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
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Impossible de lancer la lecture de l'écran ({}) : {e}", helper.display()))?;
    let stdout = child.stdout.take().ok_or("Sortie de bogo-vision indisponible.")?;
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let _ = app.emit("vision", event);
            }
        }
        let _ = app.emit("vision", serde_json::json!({ "type": "stopped" }));
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
        .invoke_handler(tauri::generate_handler![
            fetch_aoe4guides_build,
            fetch_last_game,
            open_aoe4guides,
            keep_overlay_on_top,
            start_vision,
            stop_vision,
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
