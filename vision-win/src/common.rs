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

/// L'horloge parmi les lignes lues, en tolérant les erreurs de lecture vues sous Windows :
/// « 07•.35 » (deux-points lus comme une puce), « 307:49 » (un trait de l'interface lu « 3 »
/// devant), « 02 : 05 » (espaces).
pub fn read_clock(lines: &[String]) -> Option<(u32, String)> {
    for line in lines {
        let compact: String = line.chars().filter(|c| !c.is_whitespace()).collect();
        for text in line.split_whitespace().chain(std::iter::once(compact.as_str())) {
            if let Some(found) = clock_in(text) {
                return Some(found);
            }
        }
    }
    None
}

/// Première horloge dans un texte : « m:ss », « mm:ss » ou « h:mm:ss ».
fn clock_in(text: &str) -> Option<(u32, String)> {
    let normalized: String = text
        .replace("•.", ":")
        .chars()
        .map(|c| match c {
            '•' | '·' | ';' => ':',
            'O' | 'o' => '0',
            _ => c,
        })
        .collect();
    for chunk in normalized.split(|c: char| !(c.is_ascii_digit() || c == ':')) {
        let parts: Vec<&str> = chunk.trim_matches(':').split(':').collect();
        if !(2..=3).contains(&parts.len()) || parts.iter().any(|p| p.is_empty()) {
            continue;
        }
        // Chiffres en trop devant : on garde les deux derniers (« 307 » → « 07 »).
        let first = &parts[0][parts[0].len().saturating_sub(2)..];
        let candidate = std::iter::once(first).chain(parts[1..].iter().copied()).collect::<Vec<_>>().join(":");
        if let Some(seconds) = parse_clock(&candidate) {
            return Some((seconds, candidate));
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

/// Rectangle en pixels d'une image.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cell {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

/// Colonne des villageois par ressource, en fraction de la largeur du panneau lu.
pub const GATHERER_COLUMN: (f64, f64) = (0.40, 0.55);

/// Chiffres de la colonne des villageois par ressource (image en texte sombre sur fond clair,
/// voir `invert_contrast`) : taches sombres de la taille d'un chiffre, groupées en nombres
/// (« 17 », « 0/1 »). La reconnaissance de Windows saute les chiffres isolés ; on les lui
/// présentera alignés sur une ligne (`compose_cells`).
pub fn digit_cells(image: &[u8], width: usize, height: usize, x0: usize, x1: usize) -> Vec<Cell> {
    let x1 = x1.min(width);
    if x0 >= x1 || height == 0 {
        return Vec::new();
    }
    let dark = |x: usize, y: usize| image[(y * width + x) * 4] < 128;
    let mut seen = vec![false; width * height];
    let mut blobs: Vec<Cell> = Vec::new();
    for y in 0..height {
        for x in x0..x1 {
            if seen[y * width + x] || !dark(x, y) {
                continue;
            }
            // Tache sombre : remplissage par voisinage (4 directions).
            let (mut left, mut right, mut top, mut bottom) = (x, x, y, y);
            let mut stack = vec![(x, y)];
            seen[y * width + x] = true;
            while let Some((cx, cy)) = stack.pop() {
                left = left.min(cx);
                right = right.max(cx);
                top = top.min(cy);
                bottom = bottom.max(cy);
                let neighbours = [
                    (cx.wrapping_sub(1), cy),
                    (cx + 1, cy),
                    (cx, cy.wrapping_sub(1)),
                    (cx, cy + 1),
                ];
                for (nx, ny) in neighbours {
                    if nx >= x0 && nx < x1 && ny < height && !seen[ny * width + nx] && dark(nx, ny) {
                        seen[ny * width + nx] = true;
                        stack.push((nx, ny));
                    }
                }
            }
            let (w, h) = (right - left + 1, bottom - top + 1);
            let size_ok = (h as f64) >= 0.018 * height as f64 && (h as f64) <= 0.06 * height as f64;
            // Une tache coupée par le bord gauche est l'icône du villageois, pas un chiffre.
            if size_ok && w <= h * 6 / 5 && left > x0 {
                blobs.push(Cell { x: left, y: top, w, h });
            }
        }
    }
    // L'icône du villageois dans sa case est plus haute que les chiffres : on l'écarte.
    let mut heights: Vec<usize> = blobs.iter().map(|b| b.h).collect();
    heights.sort_unstable();
    if let Some(&median) = heights.get(heights.len() / 2) {
        blobs.retain(|b| b.h * 4 <= median * 5);
    }
    // Chiffres voisins de même taille sur une même ligne : un seul nombre.
    blobs.sort_by_key(|b| (b.y, b.x));
    let mut cells: Vec<Cell> = Vec::new();
    for blob in blobs {
        let joined = cells.iter_mut().find(|c| {
            let overlap = (c.y + c.h).min(blob.y + blob.h) as f64 - c.y.max(blob.y) as f64;
            let gap = blob.x as f64 - (c.x + c.w) as f64;
            let similar = c.h.max(blob.h) * 4 <= c.h.min(blob.h) * 5;
            similar && overlap >= 0.5 * c.h.min(blob.h) as f64 && gap <= c.h.max(blob.h) as f64 && gap > -(blob.w as f64)
        });
        match joined {
            Some(cell) => {
                let (right, bottom) = ((cell.x + cell.w).max(blob.x + blob.w), (cell.y + cell.h).max(blob.y + blob.h));
                cell.x = cell.x.min(blob.x);
                cell.y = cell.y.min(blob.y);
                cell.w = right - cell.x;
                cell.h = bottom - cell.y;
            }
            None => cells.push(blob),
        }
    }
    cells
}

/// Les nombres trouvés, copiés côte à côte sur une ligne (fond blanc, espacés comme des mots) :
/// la reconnaissance de Windows lit bien une ligne de mots, mal un chiffre seul. Renvoie
/// l'image, sa taille et la place de chaque nombre sur la ligne (début, fin en x).
pub fn compose_cells(image: &[u8], width: usize, cells: &[Cell]) -> (Vec<u8>, usize, usize, Vec<(usize, usize)>) {
    let tallest = cells.iter().map(|c| c.h).max().unwrap_or(1);
    let pad = tallest;
    let gap = tallest * 3 / 2;
    let canvas_h = (tallest + 2 * pad).max(48);
    let canvas_w = (pad * 2 + cells.iter().map(|c| c.w + gap).sum::<usize>()).max(64);
    let mut canvas = vec![255u8; canvas_w * canvas_h * 4];
    let mut places = Vec::new();
    let mut x = pad;
    for cell in cells {
        // Bas des nombres alignés, comme sur une ligne de texte.
        let top = (canvas_h - pad).saturating_sub(cell.h);
        for row in 0..cell.h {
            let from = ((cell.y + row) * width + cell.x) * 4;
            let to = ((top + row) * canvas_w + x) * 4;
            canvas[to..to + cell.w * 4].copy_from_slice(&image[from..from + cell.w * 4]);
        }
        places.push((x, x + cell.w));
        x += cell.w + gap;
    }
    (canvas, canvas_w, canvas_h, places)
}

/// Les mots lus sur la ligne composée, remis à la place de leur nombre dans le panneau. Un mot
/// qui couvre plusieurs nombres (lus collés) est laissé de côté.
pub fn place_words(words: &[Word], cells: &[Cell], places: &[(usize, usize)]) -> Vec<Word> {
    let mut placed = Vec::new();
    for word in words {
        let (start, end) = (word.x, word.x + word.w);
        let hits: Vec<usize> = places
            .iter()
            .enumerate()
            .filter(|(_, (a, b))| (*b as f64) > start && (*a as f64) < end)
            .map(|(i, _)| i)
            .collect();
        if let [i] = hits[..] {
            let c = cells[i];
            placed.push(Word { text: word.text.clone(), x: c.x as f64, y: c.y as f64, w: c.w as f64, h: c.h as f64 });
        }
    }
    placed
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
        // Erreurs de lecture vues sous Windows.
        assert_eq!(read_clock(&["07•.35".to_string()]), Some((455, "07:35".to_string())));
        assert_eq!(read_clock(&["307:49".to_string()]), Some((469, "07:49".to_string())));
        assert_eq!(read_clock(&["307:52 i".to_string()]), Some((472, "07:52".to_string())));
        assert_eq!(read_clock(&["07141".to_string()]), None);
        assert_eq!(read_clock(&["ol•.A5".to_string()]), None);
        assert_eq!(read_clock(&["11".to_string(), "-10".to_string()]), None);
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

    /// Image blanche w × h où l'on peint des rectangles noirs (chiffres simulés).
    fn image(w: usize, h: usize, rects: &[(usize, usize, usize, usize)]) -> Vec<u8> {
        let mut img = vec![255u8; w * h * 4];
        for &(x, y, rw, rh) in rects {
            for yy in y..y + rh {
                for xx in x..x + rw {
                    img[(yy * w + xx) * 4..(yy * w + xx) * 4 + 3].copy_from_slice(&[0, 0, 0]);
                }
            }
        }
        img
    }

    #[test]
    fn chiffres_de_la_colonne_des_villageois() {
        // Panneau 600 × 750 : icône coupée par le bord gauche de la colonne (x 240), un « 3 »,
        // un « 17 » (deux chiffres voisins), une tache trop petite (bruit), une trop grande.
        let img = image(
            600,
            750,
            &[(236, 450, 10, 26), (255, 460, 12, 19), (255, 520, 9, 19), (268, 520, 12, 19), (260, 600, 3, 3), (250, 650, 30, 60)],
        );
        let cells = digit_cells(&img, 600, 750, 240, 330);
        assert_eq!(cells, vec![Cell { x: 255, y: 460, w: 12, h: 19 }, Cell { x: 255, y: 520, w: 25, h: 19 }]);
        // Icône plus haute que les chiffres, juste à gauche d'un « 6 » : jamais collée au chiffre.
        let img = image(600, 750, &[(245, 455, 10, 26), (262, 460, 12, 19), (255, 520, 12, 19), (255, 580, 12, 19)]);
        let cells = digit_cells(&img, 600, 750, 240, 330);
        assert_eq!(cells[0], Cell { x: 262, y: 460, w: 12, h: 19 });
        assert_eq!(cells.len(), 3);
    }

    #[test]
    fn ligne_composee_et_mots_remis_en_place() {
        let img = image(600, 750, &[(255, 460, 12, 19), (255, 520, 9, 19), (268, 520, 12, 19)]);
        let cells = digit_cells(&img, 600, 750, 240, 330);
        let (canvas, w, h, places) = compose_cells(&img, 600, &cells);
        assert_eq!(canvas.len(), w * h * 4);
        assert_eq!(places.len(), 2);
        // Les nombres sont copiés noirs sur fond blanc, séparés.
        let (a, b) = places[0];
        assert!(b <= places[1].0);
        // Bas aligné à une marge (la hauteur d'un chiffre) du bas de la ligne.
        assert_eq!(canvas[((h - 19 - 19) * w + a) * 4], 0);
        assert_eq!(canvas[0], 255);
        // « 3 » et « 17 » lus sur la ligne reviennent à leur place ; un mot à cheval est ignoré.
        let word = |text: &str, x: usize, ww: usize| Word { text: text.into(), x: x as f64, y: 10.0, w: ww as f64, h: 19.0 };
        let read = [word("3", a, b - a), word("17", places[1].0, places[1].1 - places[1].0), word("317", a, places[1].1 - a)];
        let placed = place_words(&read, &cells, &places);
        assert_eq!(placed.len(), 2);
        assert_eq!((placed[0].text.as_str(), placed[0].y), ("3", 460.0));
        assert_eq!((placed[1].text.as_str(), placed[1].y), ("17", 520.0));
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
