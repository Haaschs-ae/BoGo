/// Télécharge un BO aoe4guides au format overlay (celui de RTS_Overlay).
#[tauri::command]
async fn fetch_aoe4guides_build(id: String) -> Result<serde_json::Value, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Identifiant de build invalide.".into());
    }
    let url = format!("https://aoe4guides.com/api/builds/{id}?overlay=true");
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Connexion à aoe4guides impossible : {e}"))?;
    if !response.status().is_success() {
        return Err(format!("aoe4guides a répondu {}.", response.status()));
    }
    response
        .json()
        .await
        .map_err(|e| format!("Réponse d'aoe4guides illisible : {e}"))
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![fetch_aoe4guides_build, quit])
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
