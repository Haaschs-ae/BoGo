import { defineConfig } from "vite";

// Vite sert l'interface de l'overlay ; Tauri l'embarque dans la fenêtre native.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "safari15", outDir: "dist" },
});
