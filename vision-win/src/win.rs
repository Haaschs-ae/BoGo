//! Partie propre à Windows : trouver la fenêtre du jeu, capturer deux zones de l'écran, les lire
//! avec la reconnaissance de texte de Windows (Windows.Media.Ocr).

use std::io::Write;
use std::time::Duration;

use serde_json::{json, Value};
use windows::core::{BOOL, HSTRING, PWSTR};
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, ClientToScreen, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClientRect, GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
    IsWindowVisible, GA_ROOT,
};

use crate::common::{area_pixels, line_word, read_clock, scale_gray, token, upscale_factor, Word, CLOCK_AREA, HUD_AREA};

/// Taille d'image au-delà de laquelle la reconnaissance de Windows refuse de lire.
const FALLBACK_MAX_DIMENSION: u32 = 2600;

struct Output {
    last_status: String,
}

impl Output {
    fn emit(&mut self, event: Value) {
        let mut out = std::io::stdout().lock();
        // BoGo fermé : la sortie standard est fermée, on s'arrête.
        if writeln!(out, "{event}").and_then(|_| out.flush()).is_err() {
            std::process::exit(0);
        }
    }

    /// Les statuts ne sont envoyés que lorsqu'ils changent.
    fn status(&mut self, code: &str, extra: Option<Value>) {
        if self.last_status == code {
            return;
        }
        self.last_status = code.to_string();
        let mut event = json!({ "type": "status", "code": code });
        if let Some(Value::Object(fields)) = extra {
            event.as_object_mut().unwrap().extend(fields);
        }
        self.emit(event);
    }

    /// Une erreur n'est envoyée qu'une fois tant qu'elle se répète.
    fn error(&mut self, code: &str, message: &str) {
        let key = format!("error:{code}");
        if self.last_status == key {
            return;
        }
        self.last_status = key;
        self.emit(json!({ "type": "error", "code": code, "message": message }));
    }
}

pub fn run() {
    unsafe {
        // Coordonnées en pixels réels, même avec une mise à l'échelle de l'affichage (125 %, 150 %…).
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let _ = RoInitialize(RO_INIT_MULTITHREADED);
    }
    let mut out = Output { last_status: String::new() };
    let engine = loop {
        match ocr_engine() {
            Some(engine) => break engine,
            None => {
                out.error(
                    "ocr",
                    "La reconnaissance de texte de Windows est indisponible : ajoute l'anglais dans Paramètres → \
                     Heure et langue → Langue et région (avec « Reconnaissance optique de caractères »), puis relance BoGo.",
                );
                std::thread::sleep(Duration::from_secs(10));
            }
        }
    };
    let max_dimension = OcrEngine::MaxImageDimension().unwrap_or(FALLBACK_MAX_DIMENSION).max(500);

    loop {
        let mut delay = Duration::from_secs(1);
        let (game, apps) = find_game_window();
        match game {
            None => out.status("no_window", Some(json!({ "apps": apps }))),
            Some(game) if !game_in_front(game.hwnd) => out.status("background", None),
            Some(game) => match read_game(&engine, &game, max_dimension) {
                Ok((top_tokens, clock, hud_tokens)) => {
                    out.emit(json!({ "type": "top", "tokens": top_tokens }));
                    match clock {
                        Some((seconds, text)) => {
                            out.status("ok", None);
                            out.emit(json!({ "type": "clock", "seconds": seconds, "text": text }));
                        }
                        None => out.status("no_clock", None),
                    }
                    out.emit(json!({ "type": "hud", "tokens": hud_tokens }));
                }
                Err(message) => {
                    delay = Duration::from_secs(3);
                    out.error("capture", &message);
                }
            },
        }
        std::thread::sleep(delay);
    }
}

/// Moteur de reconnaissance : l'anglais (l'interface du jeu, l'horloge), sinon la langue de Windows.
fn ocr_engine() -> Option<OcrEngine> {
    let english = Language::CreateLanguage(&HSTRING::from("en-US")).ok();
    english
        .and_then(|language| OcrEngine::TryCreateFromLanguage(&language).ok())
        .or_else(|| OcrEngine::TryCreateFromUserProfileLanguages().ok())
}

struct GameWindow {
    hwnd: HWND,
    /// Zone cliente en pixels de l'écran.
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

struct Candidate {
    hwnd: HWND,
    title: String,
    exe: String,
    rect: (i32, i32, i32, i32),
}

/// La fenêtre d'AoE4 (Steam, Xbox) ou de GeForce Now, la plus grande ; et la liste des
/// programmes qui ont une fenêtre, pour expliquer une recherche ratée.
fn find_game_window() -> (Option<GameWindow>, Vec<String>) {
    let mut candidates: Vec<Candidate> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect_window), LPARAM(&mut candidates as *mut _ as isize));
    }
    let mut apps: Vec<String> = candidates.iter().map(|c| c.exe.clone()).filter(|e| !e.is_empty()).collect();
    apps.sort();
    apps.dedup();
    let game = candidates
        .iter()
        .filter(|c| is_game(&c.exe, &c.title) && c.rect.2 > 200 && c.rect.3 > 150)
        .max_by_key(|c| c.rect.2 as i64 * c.rect.3 as i64)
        .map(|c| GameWindow { hwnd: c.hwnd, left: c.rect.0, top: c.rect.1, width: c.rect.2, height: c.rect.3 });
    (game, apps)
}

fn is_game(exe: &str, title: &str) -> bool {
    let exe = exe.to_lowercase();
    let title = title.to_lowercase();
    exe.contains("reliccardinal")
        || exe.contains("geforcenow")
        || title.contains("age of empires iv")
        || title.contains("geforce now")
}

unsafe extern "system" fn collect_window(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let list = &mut *(lparam.0 as *mut Vec<Candidate>);
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if GetClientRect(hwnd, &mut rect).is_err() {
        return BOOL(1);
    }
    let mut origin = POINT { x: 0, y: 0 };
    if !ClientToScreen(hwnd, &mut origin).as_bool() {
        return BOOL(1);
    }
    let mut buffer = [0u16; 256];
    let length = GetWindowTextW(hwnd, &mut buffer).max(0) as usize;
    let title = String::from_utf16_lossy(&buffer[..length]);
    list.push(Candidate {
        hwnd,
        title,
        exe: process_name(hwnd),
        rect: (origin.x, origin.y, rect.right - rect.left, rect.bottom - rect.top),
    });
    BOOL(1)
}

/// Nom du programme d'une fenêtre (« RelicCardinal.exe »), ou "" s'il est illisible.
fn process_name(hwnd: HWND) -> String {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buffer = [0u16; 512];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buffer.as_mut_ptr()), &mut size).is_ok();
        let _ = CloseHandle(process);
        if !ok {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        path.rsplit(['\\', '/']).next().unwrap_or_default().to_string()
    }
}

/// On ne lit l'écran que si le jeu est devant : sinon ce serait une autre fenêtre (navigateur,
/// Discord…) qui serait lue. BoGo au premier plan (après un clic) ne compte pas : il n'apparaît
/// pas dans la capture.
fn game_in_front(game: HWND) -> bool {
    unsafe {
        let front = GetForegroundWindow();
        if front.0.is_null() {
            return true;
        }
        let root = GetAncestor(front, GA_ROOT);
        if root == game || front == game {
            return true;
        }
        process_name(root).to_lowercase() == "bogo.exe"
    }
}

type Reading = (Vec<Value>, Option<(u32, String)>, Vec<Value>);

fn read_game(engine: &OcrEngine, game: &GameWindow, max_dimension: u32) -> Result<Reading, String> {
    // Bande du haut : lignes entières (le texte compte : âge, passage d'âge).
    let top_lines = recognize(engine, game, CLOCK_AREA, max_dimension)?;
    let top_texts: Vec<String> = top_lines.iter().map(|(line, _)| line.text.clone()).collect();
    let clock = read_clock(&top_texts);
    let top_tokens = top_lines.iter().map(|(line, size)| token(line, size.0, size.1)).collect();
    // Panneau : mot par mot (les positions comptent : stock à gauche, villageois à droite).
    let hud_words = recognize_words(engine, game, HUD_AREA, max_dimension)?;
    let hud_tokens = hud_words.iter().map(|(word, size)| token(word, size.0, size.1)).collect();
    Ok((top_tokens, clock, hud_tokens))
}

type Placed = (Word, (f64, f64));

fn recognize(engine: &OcrEngine, game: &GameWindow, area: crate::common::Area, max_dimension: u32) -> Result<Vec<Placed>, String> {
    let (lines, size) = ocr_area(engine, game, area, max_dimension)?;
    Ok(lines.into_iter().filter_map(|words| line_word(&words)).map(|line| (line, size)).collect())
}

fn recognize_words(
    engine: &OcrEngine,
    game: &GameWindow,
    area: crate::common::Area,
    max_dimension: u32,
) -> Result<Vec<Placed>, String> {
    let (lines, size) = ocr_area(engine, game, area, max_dimension)?;
    Ok(lines.into_iter().flatten().map(|word| (word, size)).collect())
}

/// Capture la zone, l'agrandit, la lit : les mots de chaque ligne, et la taille de l'image lue.
fn ocr_area(
    engine: &OcrEngine,
    game: &GameWindow,
    area: crate::common::Area,
    max_dimension: u32,
) -> Result<(Vec<Vec<Word>>, (f64, f64)), String> {
    let (x, y, w, h) = area_pixels(area, game.left, game.top, game.width, game.height);
    let pixels = capture_screen(x, y, w, h)?;
    let factor = upscale_factor(w as u32, h as u32, max_dimension);
    let image = scale_gray(&pixels, w as u32, h as u32, factor);
    let (iw, ih) = (w as u32 * factor, h as u32 * factor);
    let lines = ocr(engine, &image, iw, ih).map_err(|e| format!("lecture du texte impossible ({e})"))?;
    Ok((lines, (iw as f64, ih as f64)))
}

fn ocr(engine: &OcrEngine, bgra: &[u8], width: u32, height: u32) -> windows::core::Result<Vec<Vec<Word>>> {
    let writer = DataWriter::new()?;
    writer.WriteBytes(bgra)?;
    let buffer = writer.DetachBuffer()?;
    let bitmap = SoftwareBitmap::CreateWithAlpha(BitmapPixelFormat::Bgra8, width as i32, height as i32, BitmapAlphaMode::Ignore)?;
    bitmap.CopyFromBuffer(&buffer)?;
    let result = engine.RecognizeAsync(&bitmap)?.join()?;
    let mut lines = Vec::new();
    for line in result.Lines()? {
        let mut words = Vec::new();
        for word in line.Words()? {
            let rect = word.BoundingRect()?;
            words.push(Word {
                text: word.Text()?.to_string_lossy(),
                x: rect.X as f64,
                y: rect.Y as f64,
                w: rect.Width as f64,
                h: rect.Height as f64,
            });
        }
        if !words.is_empty() {
            lines.push(words);
        }
    }
    Ok(lines)
}

/// Pixels BGRA d'une zone de l'écran, lignes de haut en bas. BoGo lui-même n'y apparaît pas
/// (il s'exclut des captures d'écran).
fn capture_screen(x: i32, y: i32, width: i32, height: i32) -> Result<Vec<u8>, String> {
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("écran inaccessible".into());
        }
        let memory = CreateCompatibleDC(Some(screen));
        let bitmap = CreateCompatibleBitmap(screen, width, height);
        let previous = SelectObject(memory, bitmap.into());
        let copied = BitBlt(memory, 0, 0, width, height, Some(screen), x, y, SRCCOPY);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let lines = GetDIBits(
            memory,
            bitmap,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut info,
            DIB_RGB_COLORS,
        );
        SelectObject(memory, previous);
        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(memory);
        ReleaseDC(None, screen);
        copied.map_err(|e| format!("capture de l'écran impossible ({e})"))?;
        if lines == 0 {
            return Err("capture de l'écran illisible".into());
        }
        Ok(pixels)
    }
}
