//! bogo-vision pour Windows : lit l'horloge et le panneau des villageois d'AoE4 à l'écran.
//!
//! Même rôle et mêmes événements que bogo-vision en Swift sur Mac : BoGo le lance, il lit la
//! fenêtre du jeu une fois par seconde (capture d'écran de deux zones, reconnaissance de texte
//! intégrée à Windows) et écrit une ligne JSON par événement sur la sortie standard :
//!   {"type":"clock","seconds":125,"text":"02:05"}
//!   {"type":"top","tokens":[…]}  {"type":"hud","tokens":[…]}
//!   {"type":"status","code":"no_window"|"background"|"no_clock"|"ok"}
//!   {"type":"error","code":"ocr"|"capture","message":"…"}
//! Il ne lit que des pixels affichés : rien n'est injecté dans le jeu ni lu dans sa mémoire.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod common;
#[cfg(windows)]
mod win;

#[cfg(windows)]
fn main() {
    win::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("bogo-vision (édition Windows) ne fonctionne que sous Windows.");
    std::process::exit(1);
}
