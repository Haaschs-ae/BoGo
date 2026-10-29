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

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![fetch_aoe4guides_build, fetch_last_game, quit])
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                // Appli « accessoire » : pas d'icône dans le Dock, et ses fenêtres
                // peuvent s'afficher dans l'espace plein écran d'une autre appli.
                _app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                if let Some(window) = _app.get_webview_window("overlay") {
                    macos::float_over_fullscreen(&window)?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de BoGo");
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2::{msg_send, runtime::AnyObject};

    // Valeurs de NSWindowCollectionBehavior et NSWindowLevel (AppKit).
    const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
    const STATIONARY: usize = 1 << 4;
    const FULL_SCREEN_AUXILIARY: usize = 1 << 8;
    const STATUS_WINDOW_LEVEL: isize = 25;

    /// Garde l'overlay visible par-dessus GeForce Now en plein écran.
    pub fn float_over_fullscreen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
        let ns_window = window.ns_window()? as *mut AnyObject;
        unsafe {
            let _: () = msg_send![
                ns_window,
                setCollectionBehavior: CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY
            ];
            let _: () = msg_send![ns_window, setLevel: STATUS_WINDOW_LEVEL];
        }
        Ok(())
    }
}
