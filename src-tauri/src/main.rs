// Pas de console en plus sur Windows en mode release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bogo_lib::run()
}
