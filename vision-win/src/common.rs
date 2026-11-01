//! Ce qui ne dépend pas de Windows : zones lues, horloge, positions des textes, agrandissement.
//! Testé sur toutes les plateformes.

use serde_json::{json, Value};

/// Zone lue, en fraction de la fenêtre du jeu (comme sur Mac) : x, y, largeur, hauteur.
pub type Area = (f64, f64, f64, f64);

/// Bande en haut au centre : horloge, âge, passage d'âge en cours.
pub const CLOCK_AREA: Area = (0.35, 0.0, 0.30, 0.25);
/// Panneau population / ressources / villageois, en bas à gauche, avec de la marge.
pub const HUD_AREA: Area = (0.0, 0.6, 0.18, 0.4);

/// Zone en pixels de l'écran pour une fenêtre placée en (left, top) de taille width × height.
pub fn area_pixels(area: Area, left: i32, top: i32, width: i32, height: i32) -> (i32, i32, i32, i32) {
    let (x, y, w, h) = area;
    let px = left + (width as f64 * x).round() as i32;
    let py = top + (height as f64 * y).round() as i32;
    let pw = ((width as f64 * w).round() as i32).max(1);
    let ph = ((height as f64 * h).round() as i32).max(1);
    (px, py, pw, ph)
}

/// "02:05" → 125, "1:02:05" → 3725 ; None si le texte n'est pas une horloge.
pub fn parse_clock(token: &str) -> Option<u32> {
    let text = token.replace(['O', 'o'], "0");
    let parts: Vec<&str> = text.split(':').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    if parts.iter().any(|p| p.is_empty() || !p.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    if parts[1..].iter().any(|p| p.len() != 2) {
        return None;
    }
    let values: Vec<u32> = parts.iter().map(|p| p.parse().unwrap_or(u32::MAX)).collect();
    if values[1..].iter().any(|&v| v >= 60) {
        return None;
    }
    Some(values.iter().fold(0, |acc, v| acc * 60 + v))
}

/// L'horloge parmi les lignes lues : un mot, ou une ligne lue avec des espaces (« 02 : 05 »).
pub fn read_clock(lines: &[String]) -> Option<(u32, String)> {
    for line in lines {
        for word in line.split_whitespace() {
            if let Some(seconds) = parse_clock(word) {
                return Some((seconds, word.to_string()));
            }
        }
        let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
        if let Some(seconds) = parse_clock(&compact) {
            return Some((seconds, compact));
        }
    }
    None
}

/// Texte lu et son cadre en pixels de l'image lue.
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    pub text: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Jeton au format de bogo-vision : position en fraction de la zone, origine en haut à gauche.
pub fn token(word: &Word, image_width: f64, image_height: f64) -> Value {
    json!({
        "text": word.text,
        "x": word.x / image_width,
        "y": word.y / image_height,
        "w": word.w / image_width,
        "h": word.h / image_height,
    })
}

/// Une ligne entière (pour la bande du haut) : textes joints, cadre englobant.
pub fn line_word(words: &[Word]) -> Option<Word> {
    let first = words.first()?;
    let (mut x1, mut y1, mut x2, mut y2) = (first.x, first.y, first.x + first.w, first.y + first.h);
    for w in &words[1..] {
        x1 = x1.min(w.x);
        y1 = y1.min(w.y);
        x2 = x2.max(w.x + w.w);
        y2 = y2.max(w.y + w.h);
    }
    let text = words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
    Some(Word { text, x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
}

/// Facteur d'agrandissement avant lecture : les petits chiffres du panneau (≈ 12 px en 1080p)
/// sont trop petits pour la reconnaissance de Windows ; sans dépasser sa taille d'image maximale.
pub fn upscale_factor(width: u32, height: u32, max_dimension: u32) -> u32 {
    let largest = width.max(height).max(1);
    (max_dimension / largest).clamp(1, 3)
}

/// Agrandit une image BGRA (bilinéaire) et la passe en niveaux de gris opaques : la
/// reconnaissance lit mieux un texte clair sur fond sombre sans les couleurs du jeu.
pub fn scale_gray(bgra: &[u8], width: u32, height: u32, factor: u32) -> Vec<u8> {
    let (w, h) = (width as usize, height as usize);
    let luma: Vec<f32> = bgra
        .chunks_exact(4)
        .map(|p| 0.114 * p[0] as f32 + 0.587 * p[1] as f32 + 0.299 * p[2] as f32)
        .collect();
    let f = factor.max(1) as usize;
    let (ow, oh) = (w * f, h * f);
    let mut out = vec![0u8; ow * oh * 4];
    for oy in 0..oh {
        let sy = ((oy as f32 + 0.5) / f as f32 - 0.5).clamp(0.0, (h - 1) as f32);
        let y0 = sy.floor() as usize;
        let y1 = (y0 + 1).min(h - 1);
        let ty = sy - y0 as f32;
        for ox in 0..ow {
            let sx = ((ox as f32 + 0.5) / f as f32 - 0.5).clamp(0.0, (w - 1) as f32);
            let x0 = sx.floor() as usize;
            let x1 = (x0 + 1).min(w - 1);
            let tx = sx - x0 as f32;
            let top = luma[y0 * w + x0] * (1.0 - tx) + luma[y0 * w + x1] * tx;
            let bottom = luma[y1 * w + x0] * (1.0 - tx) + luma[y1 * w + x1] * tx;
            let v = (top * (1.0 - ty) + bottom * ty).round().clamp(0.0, 255.0) as u8;
            let i = (oy * ow + ox) * 4;
            out[i..i + 4].copy_from_slice(&[v, v, v, 255]);
        }
    }
    out
}

/// Passe une image en niveaux de gris (sortie de `scale_gray`) en texte sombre sur fond clair,
/// contraste poussé : la reconnaissance de Windows, faite pour les documents, lit mal le texte
/// clair du jeu sur fond sombre. Le fond sombre du panneau devient blanc, le texte noir.
pub fn invert_contrast(gray: &mut [u8]) {
    for pixel in gray.chunks_exact_mut(4) {
        let inverted = 255.0 - pixel[0] as f32;
        let v = ((inverted - 60.0) * 255.0 / 140.0).round().clamp(0.0, 255.0) as u8;
        pixel[0] = v;
        pixel[1] = v;
        pixel[2] = v;
    }
}

/// Mots de deux lectures de la même image : tous ceux de la première, plus ceux de la seconde
/// qui ne recouvrent aucun mot déjà gardé (un même chiffre lu deux fois ne compte qu'une fois).
pub fn merge_words(first: Vec<Word>, second: Vec<Word>) -> Vec<Word> {
    let mut words = first;
    for word in second {
        if !words.iter().any(|kept| overlap(kept, &word) > 0.3) {
            words.push(word);
        }
    }
    words
}

/// Part de la plus petite des deux boîtes couverte par l'autre.
fn overlap(a: &Word, b: &Word) -> f64 {
    let w = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let h = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    if w <= 0.0 || h <= 0.0 {
        return 0.0;
    }
    let smaller = (a.w * a.h).min(b.w * b.h);
    if smaller <= 0.0 {
        0.0
    } else {
        w * h / smaller
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn horloge() {
        assert_eq!(parse_clock("02:05"), Some(125));
        assert_eq!(parse_clock("1:02:05"), Some(3725));
        assert_eq!(parse_clock("O2:O5"), Some(125));
        assert_eq!(parse_clock("2:5"), None);
        assert_eq!(parse_clock("02:75"), None);
        assert_eq!(parse_clock("9/10"), None);
        let lines = vec!["Âge I".to_string(), "02 : 05".to_string()];
        assert_eq!(read_clock(&lines), Some((125, "02:05".to_string())));
        assert_eq!(read_clock(&["Dark Age 00:53".to_string()]), Some((53, "00:53".to_string())));
    }

    #[test]
    fn zones_en_pixels() {
        assert_eq!(area_pixels(HUD_AREA, 0, 0, 1920, 1080), (0, 648, 346, 432));
        assert_eq!(area_pixels(CLOCK_AREA, 100, 50, 1920, 1080), (772, 50, 576, 270));
    }

    #[test]
    fn jetons_et_lignes() {
        let a = Word { text: "Âge".into(), x: 10.0, y: 20.0, w: 30.0, h: 10.0 };
        let b = Word { text: "II".into(), x: 45.0, y: 18.0, w: 10.0, h: 14.0 };
        let line = line_word(&[a.clone(), b]).unwrap();
        assert_eq!(line, Word { text: "Âge II".into(), x: 10.0, y: 18.0, w: 45.0, h: 14.0 });
        let t = token(&a, 100.0, 200.0);
        assert_eq!(t["x"], 0.1);
        assert_eq!(t["h"], 0.05);
    }

    #[test]
    fn texte_sombre_sur_fond_clair() {
        // Fond sombre du panneau (40), texte blanc (230), chiffre grisé (110).
        let mut img = vec![40, 40, 40, 255, 230, 230, 230, 255, 110, 110, 110, 255];
        invert_contrast(&mut img);
        assert_eq!(&img[0..4], &[255, 255, 255, 255]);
        assert_eq!(&img[4..8], &[0, 0, 0, 255]);
        assert!(img[8] > 100 && img[8] < 220);
    }

    #[test]
    fn fusion_de_deux_lectures() {
        let w = |text: &str, x: f64| Word { text: text.into(), x, y: 0.0, w: 10.0, h: 10.0 };
        let merged = merge_words(vec![w("56", 0.0)], vec![w("5G", 1.0), w("6", 40.0)]);
        let texts: Vec<&str> = merged.iter().map(|w| w.text.as_str()).collect();
        assert_eq!(texts, ["56", "6"]);
    }

    #[test]
    fn agrandissement() {
        assert_eq!(upscale_factor(346, 432, 2600), 3);
        assert_eq!(upscale_factor(1100, 864, 2600), 2);
        assert_eq!(upscale_factor(3000, 10, 2600), 1);
        // 2×1 pixels : noir et blanc → 4×2, niveaux de gris opaques.
        let img = [0, 0, 0, 0, 255, 255, 255, 0];
        let out = scale_gray(&img, 2, 1, 2);
        assert_eq!(out.len(), 4 * 2 * 4);
        assert_eq!(&out[0..4], &[0, 0, 0, 255]);
        assert_eq!(&out[12..16], &[255, 255, 255, 255]);
        assert!(out[4] > 0 && out[4] < 255);
    }
}
